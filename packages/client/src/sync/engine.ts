import { db } from "../db/index.ts";
import { ApiError, apiFetch } from "../lib/api.ts";
import { STORAGE_KEYS } from "../lib/storageKeys.ts";
import { safeGetItem, safeSetItem, safeRemoveItem } from "../lib/safeStorage.js";
import { classifyReasonCode } from "./reason.ts";
import { CLIENT_SYNC_DOMAINS, parseRemoteRecord } from "./clientDomains.ts";
import {
  getSyncDomain,
  SyncPullResponseSchema,
  SYNC_DIAGNOSTIC_FAILURE_THRESHOLD,
} from "@timedata/shared";
import type {
  SyncForcePushPrepareResponse,
  SyncForcePushResponse,
  SyncHealthReport,
  SyncPullResponse,
  SyncPushResponse,
  SyncChange,
  SyncStatusResponse,
  Category,
  QuickNote,
  Setting,
  Task,
  TimeEntry,
  SyncLogEntry,
  SyncPushOutcome,
} from "@timedata/shared";
import { v4 as uuid } from "uuid";

const LAST_SYNCED_SEQ_KEY = STORAGE_KEYS.lastSyncedSeq;
const SYNC_FAILURE_COUNT_KEY = STORAGE_KEYS.syncFailureCount;
type SyncLog = SyncLogEntry;

export interface SyncConflict {
  tableName: "categories" | "time_entries" | "settings";
  recordId: string;
  local: Category | Setting | TimeEntry;
  remote: Category | Setting | TimeEntry | null;
  remoteAction: "update" | "delete";
  localLog?: SyncLogEntry;
}

export interface SyncPushResult {
  accepted: number;
  rejected: number;
  conflicts: number;
  issues: SyncPushOutcome[];
  clientBugIssues: SyncPushOutcome[];
  userActionableIssues: SyncPushOutcome[];
}

export interface RegularSyncResult {
  checked: boolean;
  identical: boolean;
  backupCreated: boolean;
  pushed: number;
  rejected: number;
  pushConflicts: number;
  pushIssues: SyncPushOutcome[];
  pulled: number;
  conflicts: SyncConflict[];
}

export interface RegularSyncOptions {
  beforeMutating?: () => Promise<void>;
}

interface CompactedSyncLog extends SyncLog {
  omitFromPush?: boolean;
  sourceLogIds: string[];
}

// 账本模型：pull 只有一种问法——“#N 之后给我”；repair/全量 = sinceSeq 0。
function buildPullCursor(mode: "incremental" | "repair"): { sinceSeq: number } {
  if (mode === "repair") return { sinceSeq: 0 };
  return { sinceSeq: getLastSyncedSeq() ?? 0 };
}

export function getLastSyncedSeq(): number | null {
  const value = safeGetItem(LAST_SYNCED_SEQ_KEY);
  if (!value) return null;
  const seq = Number(value);
  return Number.isFinite(seq) ? seq : null;
}

export function setLastSyncedSeq(seq: number): void {
  safeSetItem(LAST_SYNCED_SEQ_KEY, String(seq));
}

export function advanceSeqCursor(response: SyncPullResponse | SyncForcePushResponse): void {
  const latestSeq = "latestSeq" in response ? response.latestSeq : null;
  if (typeof latestSeq !== "number") return;
  const current = getLastSyncedSeq();
  if (current == null || latestSeq > current) {
    setLastSyncedSeq(latestSeq);
  }
}

interface CategoryDeleteImpact {
  target: Category;
  categoryIds: string[];
  entryIds: string[];
}

async function getCategoryDeleteImpact(categoryId: string): Promise<CategoryDeleteImpact | null> {
  const categories = await db.categories.toArray();
  const target = categories.find((category) => category.id === categoryId);
  if (!target) return null;

  const categoryIds = [target.id];
  for (let index = 0; index < categoryIds.length; index++) {
    const parentId = categoryIds[index];
    for (const category of categories) {
      if (category.parentId === parentId) {
        categoryIds.push(category.id);
      }
    }
  }
  const categoryIdSet = new Set(categoryIds);
  const entries = await db.timeEntries.filter((entry) => categoryIdSet.has(entry.categoryId)).toArray();

  return { target, categoryIds, entryIds: entries.map((entry) => entry.id) };
}

// applyRemoteCategoryDelete moved to clientDomains.ts

function compactLogGroup(logs: SyncLog[]): CompactedSyncLog | null {
  const ordered = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const sourceLogIds = ordered.map((log) => log.id);

  if (!first || !last) return null;
  if (first.action === "create" && last.action === "delete") {
    return { ...last, sourceLogIds, omitFromPush: true };
  }
  if (first.action === "create" && last.action !== "delete") {
    return { ...last, sourceLogIds, action: "create" };
  }
  return { ...last, sourceLogIds };
}

export function compactSyncLogs(logs: SyncLog[]): CompactedSyncLog[] {
  const groups = new Map<string, SyncLog[]>();

  for (const log of logs) {
    const key = `${log.tableName}:${log.recordId}`;
    const group = groups.get(key);
    if (group) {
      group.push(log);
    } else {
      groups.set(key, [log]);
    }
  }

  return [...groups.values()]
    .map(compactLogGroup)
    .filter((log): log is CompactedSyncLog => Boolean(log))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function isSyncPushResponse(value: unknown): value is SyncPushResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<SyncPushResponse>;
  return Array.isArray(response.outcomes)
    && typeof response.accepted === "number"
    && typeof response.rejected === "number"
    && typeof response.conflicts === "number";
}

async function fetchSyncPullResponse(body: unknown, options: { timeoutMs?: number } = {}): Promise<SyncPullResponse> {
  const response = await apiFetch<unknown>("/api/sync/pull", {
    method: "POST",
    body: JSON.stringify(body),
    ...options,
  });
  const parsed = SyncPullResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("Invalid /api/sync/pull response");
  return parsed.data;
}

// parseRemote* and quickNoteNeedsApply moved to clientDomains.ts

async function applyPushResponse(
  response: SyncPushResponse,
  omittedLogIds: string[],
  sourceLogIdsByChangeKey: Map<string, string[]>,
  changeKey: (tableName: SyncChange["tableName"], recordId: string, action: SyncChange["action"]) => string,
): Promise<SyncPushResult> {
  const acceptedLogIds: string[] = [];
  const clientBugLogIds: string[] = [];
  const clientBugIssues: SyncPushOutcome[] = [];
  const userActionableIssues: SyncPushOutcome[] = [];
  const issues: SyncPushOutcome[] = [];

  for (const outcome of response.outcomes) {
    const category = classifyReasonCode(outcome.reasonCode);
    const logIds = sourceLogIdsByChangeKey.get(changeKey(outcome.tableName, outcome.recordId, outcome.action)) || [];

    switch (category) {
      case "applied":
        acceptedLogIds.push(...logIds);
        break;
      case "client_bug":
        clientBugLogIds.push(...logIds);
        clientBugIssues.push(outcome);
        break;
      case "user_actionable":
        userActionableIssues.push(outcome);
        issues.push(outcome);
        break;
      case "conflict":
      case "unknown":
        issues.push(outcome);
        break;
    }
  }

  const logIdsToMarkSynced = [...new Set([...omittedLogIds, ...acceptedLogIds, ...clientBugLogIds])];
  if (logIdsToMarkSynced.length > 0) {
    await db.syncLog.bulkUpdate(logIdsToMarkSynced.map((id) => ({ key: id, changes: { synced: 1 } })));
  }

  return {
    accepted: response.accepted,
    rejected: response.rejected,
    conflicts: response.conflicts,
    issues,
    clientBugIssues,
    userActionableIssues,
  };
}

export async function syncPush(): Promise<SyncPushResult> {
  const unsynced = await db.syncLog.filter((entry) => !entry.synced).toArray();
  if (unsynced.length === 0) return { accepted: 0, rejected: 0, conflicts: 0, issues: [], clientBugIssues: [], userActionableIssues: [] };

  const compacted = compactSyncLogs(unsynced);
  const changes: SyncChange[] = [];
  const sourceLogIdsByChangeKey = new Map<string, string[]>();
  const omittedLogIds: string[] = [];
  const categories = await db.categories.toArray();
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const includedCategoryIds = new Set(
    compacted
      .filter((log) => log.tableName === "categories")
      .map((log) => log.recordId),
  );

  const changeKey = (tableName: string, recordId: string, action: SyncChange["action"]) => `${tableName}:${recordId}:${action}`;

  for (const log of compacted) {
    if (log.omitFromPush) {
      omittedLogIds.push(...log.sourceLogIds);
      continue;
    }

    sourceLogIdsByChangeKey.set(changeKey(log.tableName, log.recordId, log.action), log.sourceLogIds);

    if (log.action === "delete") {
      changes.push({
        tableName: log.tableName,
        recordId: log.recordId,
        action: "delete",
        data: null,
        timestamp: log.timestamp,
      } as SyncChange);
      continue;
    }

    const domain = CLIENT_SYNC_DOMAINS[log.tableName];
    if (!domain) continue;
    const data = await db.table(domain.storeName).get(log.recordId);
    if (!data) continue;

    if (domain.beforePush) {
      changes.push(...domain.beforePush(data, categoriesById, log.timestamp, includedCategoryIds));
    }

    changes.push({
      tableName: log.tableName,
      recordId: log.recordId,
      action: log.action,
      data,
      timestamp: log.timestamp,
    } as SyncChange);
  }

  if (changes.length === 0) {
    if (omittedLogIds.length > 0) {
      await db.syncLog.bulkUpdate(omittedLogIds.map((id) => ({ key: id, changes: { synced: 1 } })));
    }
    return { accepted: 0, rejected: 0, conflicts: 0, issues: [], clientBugIssues: [], userActionableIssues: [] };
  }

  let response: SyncPushResponse;
  try {
    response = await apiFetch<SyncPushResponse>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes, baseSeq: getLastSyncedSeq() }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && isSyncPushResponse(error.body)) {
      return applyPushResponse(error.body, omittedLogIds, sourceLogIdsByChangeKey, changeKey);
    }
    throw error;
  }

  return applyPushResponse(response, omittedLogIds, sourceLogIdsByChangeKey, changeKey);
}

export async function syncPullSinceSeq(): Promise<{ applied: number; conflicts: SyncConflict[] }> {
  const response = await fetchSyncPullResponse(buildPullCursor("incremental"));

  const unsyncedLogs = await db.syncLog.filter((entry) => !entry.synced).toArray();
  const locallyModifiedById = new Map(unsyncedLogs.map((l) => [`${l.tableName}:${l.recordId}`, l]));

  let applied = 0;
  const conflicts: SyncConflict[] = [];

  for (const change of response.changes) {
    const domain = CLIENT_SYNC_DOMAINS[change.tableName];
    if (!domain) continue;
    const sharedDomain = getSyncDomain(change.tableName);
    const store = db.table(domain.storeName);

    if (change.action === "delete") {
      if (domain.applyRemoteDelete) {
        // Special delete handling (categories cascade):
        // check if any related records have pending sync logs
        const impact = await getCategoryDeleteImpact(change.recordId);
        if (!impact) continue;
        const pendingCategoryLog = impact.categoryIds
          .map((id) => locallyModifiedById.get(`categories:${id}`))
          .find((log): log is SyncLogEntry => Boolean(log));
        const pendingEntryLog = impact.entryIds
          .map((id) => locallyModifiedById.get(`time_entries:${id}`))
          .find((log): log is SyncLogEntry => Boolean(log));
        const localLog = pendingCategoryLog ?? pendingEntryLog;
        if (localLog) {
          conflicts.push({
            tableName: change.tableName as SyncConflict["tableName"],
            recordId: change.recordId,
            local: impact.target as SyncConflict["local"],
            remote: null,
            remoteAction: "delete",
            localLog,
          });
        } else {
          applied += await domain.applyRemoteDelete(change.recordId);
        }
      } else {
        const existing = await store.get(change.recordId);
        if (!existing) continue;
        if (sharedDomain.conflictPolicy === "manual") {
          const localLog = locallyModifiedById.get(`${change.tableName}:${change.recordId}`);
          if (localLog) {
            conflicts.push({
              tableName: change.tableName as SyncConflict["tableName"],
              recordId: change.recordId,
              local: existing as SyncConflict["local"],
              remote: null,
              remoteAction: "delete",
              localLog,
            });
          } else {
            await store.delete(change.recordId);
            applied++;
          }
        } else {
          // lww: skip if local has pending
          if (!locallyModifiedById.has(`${change.tableName}:${change.recordId}`)) {
            await store.delete(change.recordId);
            applied++;
          }
        }
      }
    } else if (change.data) {
      const remote = parseRemoteRecord(domain, change.data, change.recordId);
      if (!remote) continue;
      const existing = await store.get(change.recordId);
      const hasPending = locallyModifiedById.has(`${change.tableName}:${change.recordId}`);

      if (sharedDomain.conflictPolicy === "manual") {
        if (existing && (existing as { updatedAt: string }).updatedAt !== (remote as { updatedAt: string }).updatedAt) {
          if (hasPending) {
            const localLog = locallyModifiedById.get(`${change.tableName}:${change.recordId}`);
            conflicts.push({
              tableName: change.tableName as SyncConflict["tableName"],
              recordId: change.recordId,
              local: existing as SyncConflict["local"],
              remote: remote as SyncConflict["remote"],
              remoteAction: "update",
              localLog,
            });
          } else {
            await store.put(remote);
            applied++;
          }
        } else if (!existing) {
          await store.put(remote);
          applied++;
        }
      } else {
        // lww: skip if local has pending
        if (!hasPending) {
          const shouldApply = domain.needsApply
            ? domain.needsApply(existing, remote)
            : !existing || (existing as { updatedAt: string }).updatedAt !== (remote as { updatedAt: string }).updatedAt;
          if (shouldApply) {
            await store.put(remote);
            applied++;
          }
        }
      }
    }
  }

  advanceSeqCursor(response);
  return { applied, conflicts };
}

export async function syncForceReplace(): Promise<number> {
  const response = await fetchSyncPullResponse({ sinceSeq: 0 }, { timeoutMs: 30000 });

  await db.transaction(
    "rw",
    [...Object.values(CLIENT_SYNC_DOMAINS).map((d) => db.table(d.storeName)), db.syncLog],
    async () => {
      for (const domain of Object.values(CLIENT_SYNC_DOMAINS)) {
        await db.table(domain.storeName).clear();
      }
      await db.syncLog.clear();

      for (const change of response.changes) {
        if (change.action === "delete" || !change.data) continue;
        const domain = CLIENT_SYNC_DOMAINS[change.tableName];
        if (!domain) continue;
        const parsed = parseRemoteRecord(domain, change.data, change.recordId);
        if (parsed) await db.table(domain.storeName).put(parsed);
      }
    },
  );

  advanceSeqCursor(response);
  return response.changes.length;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  return "Web";
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

export async function localContentHash(categories: Category[], timeEntries: TimeEntry[], quickNotes: QuickNote[], tasks: Task[] = []): Promise<string> {
  const payload = JSON.stringify({
    categories: [...categories].sort((a, b) => a.id.localeCompare(b.id)),
    timeEntries: [...timeEntries].sort((a, b) => a.id.localeCompare(b.id)),
    // source/sourceLabel 只影响展示，不参与同步对齐判定。
    quickNotes: [...quickNotes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((note) => ({
        id: note.id,
        text: note.text,
        occurredAt: note.occurredAt,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        pinned: note.pinned === true,
      })),
    tasks: [...tasks].sort((a, b) => a.id.localeCompare(b.id)),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getLocalStatus(): Promise<SyncHealthReport["local"]> {
  const categories = await db.categories.toArray();
  const timeEntries = await db.timeEntries.toArray();
  const quickNotes = await db.quickNotes.toArray();
  const tasks = await db.tasks.toArray();
  const unsyncedCount = await db.syncLog.filter((entry) => !entry.synced).count();
  const contentHash = await localContentHash(categories, timeEntries, quickNotes, tasks);
  return {
    categoryCount: categories.length,
    entryCount: timeEntries.length,
    quickNoteCount: quickNotes.length,
    lastUpdatedAt: latestTimestamp([
      ...categories.map((item) => item.updatedAt),
      ...timeEntries.map((item) => item.updatedAt),
      ...quickNotes.map((item) => item.updatedAt),
    ]),
    contentHash,
    unsyncedCount,
  };
}

function syncStatusMatches(
  local: Pick<SyncHealthReport["local"], "categoryCount" | "entryCount" | "quickNoteCount" | "lastUpdatedAt" | "contentHash">,
  server: SyncStatusResponse,
): boolean {
  if (local.contentHash && server.contentHash) return local.contentHash === server.contentHash;
  return local.categoryCount === server.categoryCount
    && local.entryCount === server.entryCount
    && local.quickNoteCount === (server.quickNoteCount ?? 0)
    && local.lastUpdatedAt === server.lastUpdatedAt;
}

function compareSyncStatus(local: SyncHealthReport["local"], server: SyncStatusResponse): Pick<SyncHealthReport, "recommendation" | "reason"> {
  if (local.unsyncedCount > 0) {
    return { recommendation: "resolve_unsynced_changes", reason: `本地还有 ${local.unsyncedCount} 条未同步变更，建议先尝试普通同步或处理冲突。` };
  }
  if (syncStatusMatches(local, server)) {
    return { recommendation: "already_aligned", reason: "本地和服务端摘要一致。" };
  }
  if (local.lastUpdatedAt && (!server.lastUpdatedAt || local.lastUpdatedAt > server.lastUpdatedAt)) {
    return { recommendation: "push_to_server", reason: "本地数据更新时间晚于服务端；如果确认本地是正确版本，可考虑全量推送覆盖服务器。" };
  }
  return { recommendation: "pull_from_server", reason: "服务端数据可能更新；建议先全量拉取到本地检查。" };
}

export async function getSyncHealth(): Promise<SyncHealthReport> {
  const [local, server] = await Promise.all([
    getLocalStatus(),
    apiFetch<SyncStatusResponse>("/api/sync/status"),
  ]);
  return { local, server, ...compareSyncStatus(local, server) };
}

export async function prepareForcePush(): Promise<SyncForcePushPrepareResponse> {
  const local = await getLocalStatus();
  return apiFetch<SyncForcePushPrepareResponse>("/api/sync/force-push/prepare", {
    method: "POST",
    body: JSON.stringify({
      categoryCount: local.categoryCount,
      entryCount: local.entryCount,
      quickNoteCount: local.quickNoteCount,
      lastUpdatedAt: local.lastUpdatedAt,
    }),
  });
}

export async function syncForcePushToServer(confirmToken: string, confirmationPhrase: "OVERWRITE_SERVER"): Promise<SyncForcePushResponse> {
  const [categories, timeEntries, settings, quickNotes, tasks] = await Promise.all([
    db.categories.toArray(),
    db.timeEntries.toArray(),
    db.settings.toArray(),
    db.quickNotes.toArray(),
    db.tasks.toArray(),
  ]);

  const response = await apiFetch<SyncForcePushResponse>("/api/sync/force-push", {
    method: "POST",
    body: JSON.stringify({
      confirmToken,
      confirmationPhrase,
      categories,
      timeEntries,
      settings,
      quickNotes,
      tasks,
    }),
  });

  await db.syncLog.clear();
  advanceSeqCursor(response);
  return response;
}

async function reportToServer(logs: Array<{ action: string; detail?: string; record_count?: number }>): Promise<void> {
  try {
    const device = getDeviceName();
    await apiFetch("/api/sync-logs", {
      method: "POST",
      body: JSON.stringify(logs.map((l) => ({ ...l, device }))),
    });
  } catch {
    // best-effort, don't break sync if logging fails
  }
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("网络请求失败：");
}

export function getConsecutiveSyncFailureCount(): number {
  return Number(safeGetItem(SYNC_FAILURE_COUNT_KEY) || "0");
}

export function resetConsecutiveSyncFailures(): void {
  safeRemoveItem(SYNC_FAILURE_COUNT_KEY);
}

export function recordRegularSyncFailure(error: unknown): void {
  if (isNetworkFailure(error)) return;
  safeSetItem(SYNC_FAILURE_COUNT_KEY, String(getConsecutiveSyncFailureCount() + 1));
}

export function shouldOpenSyncDiagnostics(): boolean {
  return getConsecutiveSyncFailureCount() >= SYNC_DIAGNOSTIC_FAILURE_THRESHOLD;
}

let regularSyncInFlight: Promise<RegularSyncResult> | null = null;

export async function regularSync(options: RegularSyncOptions = {}): Promise<RegularSyncResult> {
  if (regularSyncInFlight && !options.beforeMutating) return regularSyncInFlight;
  if (regularSyncInFlight) await regularSyncInFlight;
  regularSyncInFlight = runRegularSync(options).finally(() => {
    regularSyncInFlight = null;
  });
  return regularSyncInFlight;
}

async function runRegularSync(options: RegularSyncOptions = {}): Promise<RegularSyncResult> {
  try {
    const [unsyncedCount, serverStatus] = await Promise.all([
      db.syncLog.filter((entry) => !entry.synced).count(),
      apiFetch<SyncStatusResponse>("/api/sync/status"),
    ]);

    // 账本读数比较：无待上传且本地读数不落后于云端账本 = 无需同步。
    // contentHash 不再参与主路径，仅保留在 getSyncHealth() 诊断工具里做深度体检。
    const serverSeq = serverStatus.latestSeq ?? 0;
    const localSeq = getLastSyncedSeq() ?? 0;
    if (unsyncedCount === 0 && serverSeq <= localSeq) {
      resetConsecutiveSyncFailures();
      return {
        checked: true,
        identical: true,
        backupCreated: false,
        pushed: 0,
        rejected: 0,
        pushConflicts: 0,
        pushIssues: [],
        pulled: 0,
        conflicts: [],
      };
    }

    if (options.beforeMutating) {
      await options.beforeMutating();
    }

    if (unsyncedCount === 0) {
      const { applied, conflicts } = await syncPullSinceSeq();
      await reportToServer([{ action: "pull_seq_catchup", record_count: applied }]);
      resetConsecutiveSyncFailures();
      return {
        checked: true,
        identical: false,
        backupCreated: Boolean(options.beforeMutating),
        pushed: 0,
        rejected: 0,
        pushConflicts: 0,
        pushIssues: [],
        pulled: applied,
        conflicts,
      };
    }

    const pushResult = await syncPush();
    const { applied, conflicts } = await syncPullSinceSeq();
    const logs: Array<{ action: string; detail?: string; record_count?: number }> = [
      { action: "push", record_count: pushResult.accepted },
      { action: "pull_since_seq", record_count: applied },
    ];

    if (conflicts.length > 0) {
      logs.push({ action: "conflict", detail: describeConflicts(conflicts), record_count: conflicts.length });
    }

    await reportToServer(logs);
    resetConsecutiveSyncFailures();
    return {
      checked: true,
      identical: false,
      backupCreated: Boolean(options.beforeMutating),
      pushed: pushResult.accepted,
      rejected: pushResult.rejected,
      pushConflicts: pushResult.conflicts,
      pushIssues: pushResult.issues,
      pulled: applied,
      conflicts,
    };
  } catch (error) {
    recordRegularSyncFailure(error);
    throw error;
  }
}

function describeConflicts(conflicts: SyncConflict[]): string {
  return conflicts.map((c) => {
    const localUp = (c.local as TimeEntry).updatedAt || (c.local as Category).updatedAt;
    const remoteUp = c.remote ? ((c.remote as TimeEntry).updatedAt || (c.remote as Category).updatedAt) : "deleted";
    return `${c.tableName}:${c.recordId} local=${localUp} remote=${remoteUp} localLog=${c.localLog?.action || "none"}@${c.localLog?.timestamp || "none"}`;
  }).join("\n");
}

export async function syncPull(options: { mode?: "incremental" | "repair" } = {}): Promise<number> {
  const mode = options.mode || "incremental";

  const response = await fetchSyncPullResponse(buildPullCursor(mode));

  let applied = 0;

  for (const change of response.changes) {
    const domain = CLIENT_SYNC_DOMAINS[change.tableName];
    if (!domain) continue;
    const store = db.table(domain.storeName);

    if (change.action === "delete") {
      if (domain.applyRemoteDelete) {
        applied += await domain.applyRemoteDelete(change.recordId);
      } else {
        const existing = await store.get(change.recordId);
        if (existing) {
          await store.delete(change.recordId);
          applied++;
        }
      }
    } else if (change.data) {
      const remote = parseRemoteRecord(domain, change.data, change.recordId);
      if (!remote) continue;
      const existing = await store.get(change.recordId);

      if (mode === "repair" && existing && domain.shouldSkipOnRepair?.(existing, remote)) {
        continue;
      }

      const shouldApply = domain.needsApply
        ? domain.needsApply(existing, remote)
        : !existing || (existing as { updatedAt: string }).updatedAt !== (remote as { updatedAt: string }).updatedAt;
      if (shouldApply) {
        await store.put(remote);
        applied++;
      }
    }
  }

  advanceSeqCursor(response);
  return applied;
}

export async function recordSyncLog(
  tableName: SyncLogEntry["tableName"],
  recordId: string,
  action: "create" | "update" | "delete",
  timestamp = new Date().toISOString(),
): Promise<void> {
  await db.syncLog.add({
    id: uuid(),
    tableName,
    recordId,
    action,
    timestamp,
    synced: 0,
  });
}
