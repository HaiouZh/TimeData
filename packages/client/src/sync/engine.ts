import { db } from "../db/index.ts";
import { ApiError, apiFetch } from "../lib/api.ts";
import { STORAGE_KEYS } from "../lib/storageKeys.ts";
import { categoryDependencyChangesForEntry } from "./changes.ts";
import { SyncPullResponseSchema, SYNC_DIAGNOSTIC_FAILURE_THRESHOLD } from "@timedata/shared";
import type { SyncForcePushPrepareResponse, SyncForcePushResponse, SyncHealthReport, SyncPullResponse, SyncPushResponse, SyncChange, SyncStatusResponse, Category, TimeEntry, SyncLogEntry, SyncPushOutcome } from "@timedata/shared";
import { v4 as uuid } from "uuid";

const LAST_SYNCED_KEY = STORAGE_KEYS.lastSynced;
const LAST_SYNCED_SEQ_KEY = STORAGE_KEYS.lastSyncedSeq;
const SYNC_FAILURE_COUNT_KEY = STORAGE_KEYS.syncFailureCount;
type SyncLog = SyncLogEntry;

export interface SyncConflict {
  tableName: "categories" | "time_entries";
  recordId: string;
  local: Category | TimeEntry;
  remote: Category | TimeEntry | null;
  remoteAction: "update" | "delete";
  localLog?: SyncLogEntry;
}

export interface SyncPushResult {
  accepted: number;
  rejected: number;
  conflicts: number;
  issues: SyncPushOutcome[];
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

function buildPullCursor(mode: "incremental" | "repair", fallbackSince?: string): { lastSyncedAt: string | null; since?: string; sinceSeq?: number } {
  if (mode === "repair") return { lastSyncedAt: null };
  const sinceSeq = getLastSyncedSeq();
  if (sinceSeq != null) return { lastSyncedAt: "1970-01-01T00:00:00.000Z", sinceSeq };
  const lastSyncedAt = localStorage.getItem(LAST_SYNCED_KEY);
  return fallbackSince ? { lastSyncedAt: null, since: fallbackSince } : { lastSyncedAt };
}

export function getLastSyncedSeq(): number | null {
  const value = localStorage.getItem(LAST_SYNCED_SEQ_KEY);
  if (!value) return null;
  const seq = Number(value);
  return Number.isFinite(seq) ? seq : null;
}

export function setLastSyncedSeq(seq: number): void {
  localStorage.setItem(LAST_SYNCED_SEQ_KEY, String(seq));
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

async function applyRemoteCategoryDelete(categoryId: string): Promise<number> {
  return db.transaction("rw", db.categories, db.timeEntries, async () => {
    const impact = await getCategoryDeleteImpact(categoryId);
    if (!impact) return 0;

    await db.timeEntries.bulkDelete(impact.entryIds);
    await db.categories.bulkDelete(impact.categoryIds);

    return impact.categoryIds.length + impact.entryIds.length;
  });
}

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

async function enqueueLocalOnlyChanges(localSnapshot: Snapshot, cloudSnapshot: Snapshot): Promise<void> {
  const cloudCategoryIds = new Set(cloudSnapshot.categories.map((category) => category.id));
  const cloudEntryIds = new Set(cloudSnapshot.timeEntries.map((entry) => entry.id));
  const unsyncedLogs = await db.syncLog.filter((entry) => !entry.synced).toArray();
  const existingLogKeys = new Set(unsyncedLogs.map((entry) => `${entry.tableName}:${entry.recordId}`));
  const logs: SyncLogEntry[] = [];

  for (const category of localSnapshot.categories) {
    const key = `categories:${category.id}`;
    if (!cloudCategoryIds.has(category.id) && !existingLogKeys.has(key)) {
      logs.push({ id: uuid(), tableName: "categories", recordId: category.id, action: "create", timestamp: category.updatedAt, synced: 0 });
    }
  }

  for (const entry of localSnapshot.timeEntries) {
    const key = `time_entries:${entry.id}`;
    if (!cloudEntryIds.has(entry.id) && !existingLogKeys.has(key)) {
      logs.push({ id: uuid(), tableName: "time_entries", recordId: entry.id, action: "create", timestamp: entry.updatedAt, synced: 0 });
    }
  }

  if (logs.length > 0) {
    await db.syncLog.bulkAdd(logs);
  }
}

async function applyPushResponse(
  response: SyncPushResponse,
  omittedLogIds: string[],
  sourceLogIdsByChangeKey: Map<string, string[]>,
  changeKey: (tableName: SyncChange["tableName"], recordId: string, action: SyncChange["action"]) => string,
): Promise<SyncPushResult> {
  const acceptedLogIds = response.outcomes
    .filter((item) => item.status === "accepted")
    .flatMap((item) => sourceLogIdsByChangeKey.get(changeKey(item.tableName, item.recordId, item.action)) || []);
  const logIdsToMarkSynced = [...new Set([...omittedLogIds, ...acceptedLogIds])];

  if (logIdsToMarkSynced.length > 0) {
    await db.syncLog.bulkUpdate(logIdsToMarkSynced.map((id) => ({ key: id, changes: { synced: 1 } })));
  }

  return {
    accepted: response.accepted,
    rejected: response.rejected,
    conflicts: response.conflicts,
    issues: response.outcomes.filter((item) => item.status !== "accepted"),
  };
}

export async function syncPush(): Promise<SyncPushResult> {
  const unsynced = await db.syncLog.filter((entry) => !entry.synced).toArray();
  if (unsynced.length === 0) return { accepted: 0, rejected: 0, conflicts: 0, issues: [] };

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

  const changeKey = (tableName: SyncChange["tableName"], recordId: string, action: SyncChange["action"]) => `${tableName}:${recordId}:${action}`;

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
      });
      continue;
    }

    if (log.tableName === "categories") {
      const data = await db.categories.get(log.recordId);
      if (!data) continue;
      changes.push({
        tableName: "categories",
        recordId: log.recordId,
        action: log.action,
        data,
        timestamp: log.timestamp,
      });
      continue;
    }

    const data = await db.timeEntries.get(log.recordId);
    if (!data) continue;
    changes.push(...categoryDependencyChangesForEntry(data, categoriesById, log.timestamp, includedCategoryIds));
    changes.push({
      tableName: "time_entries",
      recordId: log.recordId,
      action: log.action,
      data,
      timestamp: log.timestamp,
    });
  }

  if (changes.length === 0) {
    if (omittedLogIds.length > 0) {
      await db.syncLog.bulkUpdate(omittedLogIds.map((id) => ({ key: id, changes: { synced: 1 } })));
    }
    return { accepted: 0, rejected: 0, conflicts: 0, issues: [] };
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

export async function syncPullRecent(days: number): Promise<{ applied: number; conflicts: SyncConflict[] }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const response = await fetchSyncPullResponse(buildPullCursor("incremental", since));

  const unsyncedLogs = await db.syncLog.filter((entry) => !entry.synced).toArray();
  const locallyModifiedById = new Map(unsyncedLogs.map((l) => [`${l.tableName}:${l.recordId}`, l]));

  let applied = 0;
  const conflicts: SyncConflict[] = [];

  for (const change of response.changes) {
    if (change.tableName === "categories") {
      if (change.action === "delete") {
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
            tableName: "categories",
            recordId: change.recordId,
            local: impact.target,
            remote: null,
            remoteAction: "delete",
            localLog,
          });
        } else {
          applied += await applyRemoteCategoryDelete(change.recordId);
        }
      } else if (change.data) {
        const existing = await db.categories.get(change.recordId);
        if (existing && existing.updatedAt !== (change.data as Category).updatedAt) {
          if (locallyModifiedById.has(`categories:${change.recordId}`)) {
            const localLog = locallyModifiedById.get(`categories:${change.recordId}`);
            conflicts.push({
              tableName: "categories",
              recordId: change.recordId,
              local: existing,
              remote: change.data as Category,
              remoteAction: "update",
              localLog,
            });
          } else {
            await db.categories.put(change.data as Category);
            applied++;
          }
        } else if (!existing) {
          await db.categories.put(change.data as Category);
          applied++;
        }
      }
    } else if (change.tableName === "time_entries") {
      if (change.action === "delete") {
        const existing = await db.timeEntries.get(change.recordId);
        if (!existing) continue;
        const localLog = locallyModifiedById.get(`time_entries:${change.recordId}`);
        if (localLog) {
          conflicts.push({
            tableName: "time_entries",
            recordId: change.recordId,
            local: existing,
            remote: null,
            remoteAction: "delete",
            localLog,
          });
        } else {
          await db.timeEntries.delete(change.recordId);
          applied++;
        }
      } else if (change.data) {
        const existing = await db.timeEntries.get(change.recordId);
        if (existing && existing.updatedAt !== (change.data as TimeEntry).updatedAt) {
          if (locallyModifiedById.has(`time_entries:${change.recordId}`)) {
            const localLog = locallyModifiedById.get(`time_entries:${change.recordId}`);
            conflicts.push({
              tableName: "time_entries",
              recordId: change.recordId,
              local: existing,
              remote: change.data as TimeEntry,
              remoteAction: "update",
              localLog,
            });
          } else {
            await db.timeEntries.put(change.data as TimeEntry);
            applied++;
          }
        } else if (!existing) {
          await db.timeEntries.put(change.data as TimeEntry);
          applied++;
        }
      }
    }
  }

  advanceSeqCursor(response);
  advanceLastSyncedCursor(response.changes);
  return { applied, conflicts };
}

function latestChangeTimestamp(changes: SyncChange[]): string | null {
  return changes.map((change) => change.timestamp).filter(Boolean).sort().at(-1) ?? null;
}

function advanceLastSyncedCursor(changes: SyncChange[]): void {
  const cursor = latestChangeTimestamp(changes);
  if (cursor) {
    localStorage.setItem(LAST_SYNCED_KEY, cursor);
  }
}

export async function syncForceReplace(): Promise<number> {
  const response = await fetchSyncPullResponse({ lastSyncedAt: null }, { timeoutMs: 30000 });

  await db.transaction("rw", db.categories, db.timeEntries, db.syncLog, async () => {
    await db.timeEntries.clear();
    await db.syncLog.clear();
    await db.categories.clear();

    for (const change of response.changes) {
      if (change.tableName === "categories" && change.data) {
        await db.categories.put(change.data as Category);
      } else if (change.tableName === "time_entries" && change.data) {
        await db.timeEntries.put(change.data as TimeEntry);
      }
    }
  });

  localStorage.setItem(LAST_SYNCED_KEY, response.serverTime);
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

async function localContentHash(categories: Category[], timeEntries: TimeEntry[]): Promise<string> {
  const payload = JSON.stringify({
    categories: [...categories].sort((a, b) => a.id.localeCompare(b.id)),
    timeEntries: [...timeEntries].sort((a, b) => a.id.localeCompare(b.id)),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getLocalStatus(): Promise<SyncHealthReport["local"]> {
  const categories = await db.categories.toArray();
  const timeEntries = await db.timeEntries.toArray();
  const unsyncedCount = await db.syncLog.filter((entry) => !entry.synced).count();
  const contentHash = await localContentHash(categories, timeEntries);
  return {
    categoryCount: categories.length,
    entryCount: timeEntries.length,
    lastUpdatedAt: latestTimestamp([...categories.map((item) => item.updatedAt), ...timeEntries.map((item) => item.updatedAt)]),
    contentHash,
    unsyncedCount,
  };
}

function syncStatusMatches(local: Pick<SyncHealthReport["local"], "categoryCount" | "entryCount" | "lastUpdatedAt" | "contentHash">, server: SyncStatusResponse): boolean {
  if (local.contentHash && server.contentHash) return local.contentHash === server.contentHash;
  return local.categoryCount === server.categoryCount
    && local.entryCount === server.entryCount
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
      lastUpdatedAt: local.lastUpdatedAt,
    }),
  });
}

export async function syncForcePushToServer(confirmToken: string, confirmationPhrase: "OVERWRITE_SERVER"): Promise<SyncForcePushResponse> {
  const [categories, timeEntries] = await Promise.all([
    db.categories.toArray(),
    db.timeEntries.toArray(),
  ]);

  const response = await apiFetch<SyncForcePushResponse>("/api/sync/force-push", {
    method: "POST",
    body: JSON.stringify({
      confirmToken,
      confirmationPhrase,
      categories,
      timeEntries,
    }),
  });

  await db.syncLog.clear();
  localStorage.setItem(LAST_SYNCED_KEY, response.serverTime);
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
  return Number(localStorage.getItem(SYNC_FAILURE_COUNT_KEY) || "0");
}

export function resetConsecutiveSyncFailures(): void {
  localStorage.removeItem(SYNC_FAILURE_COUNT_KEY);
}

export function recordRegularSyncFailure(error: unknown): void {
  if (isNetworkFailure(error)) return;
  localStorage.setItem(SYNC_FAILURE_COUNT_KEY, String(getConsecutiveSyncFailureCount() + 1));
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
  if (localStorage.getItem(STORAGE_KEYS.legacySnapshotSync) === "1") {
    return regularSyncLegacy(options);
  }

  try {
    const [localStatus, serverStatus] = await Promise.all([
      getLocalStatus(),
      apiFetch<SyncStatusResponse>("/api/sync/status"),
    ]);

    if (localStatus.unsyncedCount === 0 && syncStatusMatches(localStatus, serverStatus)) {
      advanceSeqCursor({ changes: [], serverTime: serverStatus.serverTime, latestSeq: serverStatus.latestSeq });
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

    if (localStatus.unsyncedCount === 0) {
      const { applied, conflicts } = await syncPullRecent(7);
      await reportToServer([{ action: "pull_meta_repair", record_count: applied }]);
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
    const { applied, conflicts } = await syncPullRecent(7);
    const logs: Array<{ action: string; detail?: string; record_count?: number }> = [
      { action: "push", record_count: pushResult.accepted },
      { action: "pull_recent_7d", record_count: applied },
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

async function regularSyncLegacy(options: RegularSyncOptions = {}): Promise<RegularSyncResult> {
  try {
    const [localSnapshot, cloudSnapshot] = await Promise.all([loadLocalSnapshot(), loadCloudSnapshot()]);

    if (snapshotsMatch(localSnapshot, cloudSnapshot)) {
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

    await enqueueLocalOnlyChanges(localSnapshot, cloudSnapshot);
    const pushResult = await syncPush();
    const { applied, conflicts } = await syncPullRecent(2);

    const logs: Array<{ action: string; detail?: string; record_count?: number }> = [];
    logs.push({ action: "push", record_count: pushResult.accepted });
    logs.push({ action: "pull_recent_2d", record_count: applied });

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

interface Snapshot {
  categories: Category[];
  timeEntries: TimeEntry[];
}

async function loadLocalSnapshot(): Promise<Snapshot> {
  const [categories, timeEntries] = await Promise.all([db.categories.toArray(), db.timeEntries.toArray()]);
  return {
    categories: normalizeCategories(categories),
    timeEntries: normalizeTimeEntries(timeEntries),
  };
}

async function loadCloudSnapshot(): Promise<Snapshot> {
  const response = await fetchSyncPullResponse({ lastSyncedAt: null });

  const categories: Category[] = [];
  const timeEntries: TimeEntry[] = [];

  for (const change of response.changes) {
    if (change.tableName === "categories" && change.action !== "delete" && change.data) {
      categories.push(change.data as Category);
    } else if (change.tableName === "time_entries" && change.action !== "delete" && change.data) {
      timeEntries.push(change.data as TimeEntry);
    }
  }

  return {
    categories: normalizeCategories(categories),
    timeEntries: normalizeTimeEntries(timeEntries),
  };
}

function normalizeCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeTimeEntries(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => a.id.localeCompare(b.id));
}

function snapshotsMatch(localSnapshot: Snapshot, cloudSnapshot: Snapshot): boolean {
  return JSON.stringify(localSnapshot) === JSON.stringify(cloudSnapshot);
}

export async function syncPull(options: { mode?: "incremental" | "repair" } = {}): Promise<number> {
  const mode = options.mode || "incremental";

  const response = await fetchSyncPullResponse(buildPullCursor(mode));

  let applied = 0;

  for (const change of response.changes) {
    if (change.tableName === "categories") {
      if (change.action === "delete") {
        applied += await applyRemoteCategoryDelete(change.recordId);
      } else if (change.data) {
        const existing = await db.categories.get(change.recordId);
        if (!existing || existing.updatedAt !== (change.data as Category).updatedAt) {
          await db.categories.put(change.data as Category);
          applied++;
        }
      }
    } else if (change.tableName === "time_entries") {
      if (change.action === "delete") {
        const existing = await db.timeEntries.get(change.recordId);
        if (existing) {
          await db.timeEntries.delete(change.recordId);
          applied++;
        }
      } else if (change.data) {
        const existing = await db.timeEntries.get(change.recordId);
        if (mode === "repair" && existing && isCompleteEntry(existing) && existing.updatedAt >= change.data.updatedAt) {
          // skip — local is complete and newer
        } else if (!existing || existing.updatedAt !== (change.data as TimeEntry).updatedAt) {
          await db.timeEntries.put(change.data as TimeEntry);
          applied++;
        }
      }
    }
  }

  advanceSeqCursor(response);
  advanceLastSyncedCursor(response.changes);
  return applied;
}

function isCompleteEntry(entry: TimeEntry): boolean {
  return Boolean(entry.categoryId && entry.startTime && entry.endTime);
}

export async function recordSyncLog(
  tableName: "categories" | "time_entries",
  recordId: string,
  action: "create" | "update" | "delete"
): Promise<void> {
  await db.syncLog.add({
    id: uuid(),
    tableName,
    recordId,
    action,
    timestamp: new Date().toISOString(),
    synced: 0,
  });
}
