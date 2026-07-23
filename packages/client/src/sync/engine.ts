import { db } from "../db/index.ts";
import { ApiError, apiFetch } from "../lib/api.ts";
import { STORAGE_KEYS } from "../lib/storageKeys.ts";
import { safeGetItem, safeSetItem, safeRemoveItem } from "../lib/safeStorage.js";
import type { Table } from "dexie";
import { classifyReasonCode } from "./reason.ts";
import { CLIENT_SYNC_DOMAINS, parseRemoteRecord, type ClientDomainConfig } from "./clientDomains.ts";
import type { PhaseRecorder } from "./phaseTimings.ts";
import { syncScheduler } from "./scheduler.js";
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

// 对冲策略归 engine（api.ts 只提供机制）：仅幂等同步请求启用；≈热连接 p75 的 3 倍。
export const SYNC_HEDGE_DELAY_MS = 1500;
const SYNC_HEDGE = { delayMs: SYNC_HEDGE_DELAY_MS } as const;

export interface SyncConflict {
  tableName: "categories" | "time_entries" | "settings";
  recordId: string;
  local: Category | Setting | TimeEntry;
  remote: Category | Setting | TimeEntry | null;
  remoteAction: "update" | "delete";
  localLog?: SyncLogEntry;
  sourceLogIds?: string[];
}

export interface SyncPushResult {
  accepted: number;
  rejected: number;
  conflicts: number;
  issues: SyncPushOutcome[];
  clientBugIssues: SyncPushOutcome[];
  userActionableIssues: SyncPushOutcome[];
  baseSeq: number | null;
  serverLatestSeq: number | null;
  appliedCount: number | null;
}

// 写后能否跳过回声 pull：仅当 push 全干净、服务端回执带齐 seq 字段、
// 且 [baseSeq → latestSeq] 全部增量恰好等于本次 push 记账数（无别的设备插队）。
export function canSkipEchoPull(result: SyncPushResult): boolean {
  if (result.rejected > 0 || result.conflicts > 0 || result.issues.length > 0) return false;
  const { baseSeq, serverLatestSeq, appliedCount } = result;
  if (baseSeq == null || serverLatestSeq == null || appliedCount == null) return false;
  return serverLatestSeq - baseSeq === appliedCount;
}

export interface RegularSyncResult {
  checked: boolean;
  identical: boolean;
  pushed: number;
  rejected: number;
  pushConflicts: number;
  pushIssues: SyncPushOutcome[];
  pulled: number;
  conflicts: SyncConflict[];
}

export interface RegularSyncOptions {
  phases?: PhaseRecorder;
}

interface CompactedSyncLog extends SyncLog {
  omitFromPush?: boolean;
  sourceLogIds: string[];
}

function storeKeyForRecordId(domain: ClientDomainConfig, recordId: string): string | [string, string, string] {
  return domain.keyFromRecordId ? domain.keyFromRecordId(recordId) : recordId;
}

// 账本模型：pull 只有一种问法——“#N 之后给我”；repair/全量 = sinceSeq 0。
function buildPullCursor(mode: "incremental" | "repair"): { sinceSeq: number } {
  if (mode === "repair") return { sinceSeq: 0 };
  return { sinceSeq: getLastSyncedSeq() ?? 0 };
}

// 每批最多拉多少条 change；长离线设备也不会一次性把巨量 change 灌进主线程。
export const PULL_PAGE_LIMIT = 500;

// syncLog.synced 死信位：服务端确定性拒收（非 client_bug/stale）的日志隔离于此，
// 不参与 push/pending 统计，避免每轮同步重复引爆原子 409。
export const SYNC_LOG_QUARANTINED = 2;

// 独立函数便于测试 spy，避免真实定时等待进入断言路径。
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function getLastSyncedSeq(): number | null {
  const value = safeGetItem(LAST_SYNCED_SEQ_KEY);
  if (!value) return null;
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
}

export function setLastSyncedSeq(seq: number): void {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new Error(`Invalid sync sequence cursor: ${seq}`);
  }
  safeSetItem(LAST_SYNCED_SEQ_KEY, String(seq));
}

// 本地时钟与服务器的偏差（本地 - 服务器，毫秒）。staleGuard 会比较跨端时间戳，偏差过大需提示用户校准系统时间。
export const CLOCK_SKEW_WARN_MS = 60_000;

export function recordClockSkew(serverTime: string): void {
  const parsed = new Date(serverTime).getTime();
  if (!Number.isFinite(parsed)) return;
  safeSetItem(STORAGE_KEYS.clockSkewMs, String(Date.now() - parsed));
}

export function getClockSkewMs(): number | null {
  const raw = safeGetItem(STORAGE_KEYS.clockSkewMs);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
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

type PendingLogsByRecord = Map<string, SyncLogEntry[]>;

function syncRecordKey(tableName: string, recordId: string): string {
  return `${tableName}:${recordId}`;
}

function groupPendingLogs(logs: SyncLogEntry[]): PendingLogsByRecord {
  const grouped = new Map<string, SyncLogEntry[]>();
  for (const log of logs) {
    const key = syncRecordKey(log.tableName, log.recordId);
    const current = grouped.get(key);
    if (current) current.push(log);
    else grouped.set(key, [log]);
  }
  return grouped;
}

function pendingLogsForRecord(
  pendingByRecord: PendingLogsByRecord,
  tableName: string,
  recordId: string,
): SyncLogEntry[] {
  return pendingByRecord.get(syncRecordKey(tableName, recordId)) ?? [];
}

async function getCategoryDeleteImpacts(categoryIds: string[]): Promise<Map<string, CategoryDeleteImpact>> {
  if (categoryIds.length === 0) return new Map();

  const [categories, entries] = await Promise.all([
    db.categories.toArray(),
    db.timeEntries.toArray(),
  ]);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const childrenByParent = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const children = childrenByParent.get(category.parentId);
    if (children) children.push(category.id);
    else childrenByParent.set(category.parentId, [category.id]);
  }

  const impacts = new Map<string, CategoryDeleteImpact>();
  for (const categoryId of categoryIds) {
    const target = categoriesById.get(categoryId);
    if (!target) continue;

    const impactedIds = new Set<string>([categoryId]);
    const queue = [categoryId];
    for (let index = 0; index < queue.length; index++) {
      for (const childId of childrenByParent.get(queue[index]) ?? []) {
        if (impactedIds.has(childId)) continue;
        impactedIds.add(childId);
        queue.push(childId);
      }
    }
    impacts.set(categoryId, {
      target,
      categoryIds: [...impactedIds],
      entryIds: entries.filter((entry) => impactedIds.has(entry.categoryId)).map((entry) => entry.id),
    });
  }
  return impacts;
}

// applyRemoteCategoryDelete moved to clientDomains.ts

function compactLogGroup(logs: SyncLog[]): CompactedSyncLog | null {
  const ordered = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const sourceLogIds = ordered.map((log) => log.id);
  const op = [...ordered].reverse().find((log) => log.op)?.op;

  if (!first || !last) return null;
  if (first.action === "create" && last.action === "delete") {
    return { ...last, sourceLogIds, omitFromPush: true };
  }
  if (first.action === "create" && last.action !== "delete") {
    return { ...last, sourceLogIds, action: "create", ...(op ? { op } : {}) };
  }
  return { ...last, sourceLogIds, ...(op ? { op } : {}) };
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
    hedge: SYNC_HEDGE,
    ...options,
  });
  const parsed = SyncPullResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("Invalid /api/sync/pull response");
  return parsed.data;
}

function pullBatchTables(response: SyncPullResponse): Table[] {
  const tables = new Map<string, Table>();
  tables.set("syncLog", db.syncLog);
  for (const change of response.changes) {
    const domain = CLIENT_SYNC_DOMAINS[change.tableName];
    if (domain) tables.set(domain.storeName, db.table(domain.storeName));
    if (change.tableName === "categories" && change.action === "delete") {
      tables.set("categories", db.categories);
      tables.set("timeEntries", db.timeEntries);
    }
  }
  return [...tables.values()];
}

function validatePullPageProgress(response: SyncPullResponse, cursor: number): void {
  if (!response.hasMore) return;
  const next = response.nextSinceSeq;
  if (typeof next !== "number" || next <= cursor) {
    throw new Error("Invalid /api/sync/pull pagination: hasMore requires an advancing nextSinceSeq");
  }
  if (typeof response.latestSeq === "number" && next > response.latestSeq) {
    throw new Error("Invalid /api/sync/pull pagination: nextSinceSeq exceeds latestSeq");
  }
}

// 分批拉取骨架：游标推进（红线：逐批推进，绝不中途跳到 latestSeq）只在此处，
// 具体 apply 逻辑（repair 跳过策略 / conflict 检测）由调用方以回调注入，杜绝两份游标逻辑漂移。
// 中途某批失败：异常向上抛，游标已停在上一批成功的 nextSinceSeq，下次从此断点续传。
async function fetchPullBatches(
  startSeq: number,
  applyBatch: (response: SyncPullResponse) => Promise<void>,
): Promise<SyncPullResponse> {
  let cursor = startSeq;
  let lastResponse: SyncPullResponse | undefined;
  for (;;) {
    const response = await fetchSyncPullResponse({ sinceSeq: cursor, limit: PULL_PAGE_LIMIT });
    recordClockSkew(response.serverTime);
    validatePullPageProgress(response, cursor);
    await applyBatch(response);
    lastResponse = response;
    const next = response.nextSinceSeq;
    if (typeof next === "number" && next > cursor) {
      cursor = next;
      // 逐批推进（绝不中途跳 latestSeq），且游标只增不减：repair 从 sinceSeq=0 起步时
      // 不把已在高位的读数拉回低位（apply 照常全量，游标走 max 语义、断点续传不受损）。
      if (cursor > (getLastSyncedSeq() ?? 0)) setLastSyncedSeq(cursor);
    }
    if (!response.hasMore) break;
    await yieldToMainThread();
  }
  return lastResponse;
}

// parseRemote* and quickNoteNeedsApply moved to clientDomains.ts

async function applyPushResponse(
  response: SyncPushResponse,
  sourceLogIdsByChangeKey: Map<string, string[]>,
  changeKey: (tableName: SyncChange["tableName"], recordId: string, action: SyncChange["action"]) => string,
  baseSeq: number | null,
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
      case "stale_rejected":
        acceptedLogIds.push(...logIds);
        issues.push(outcome);
        break;
      case "conflict":
      case "unknown":
        issues.push(outcome);
        break;
    }
  }

  const logIdsToMarkSynced = [...new Set([...acceptedLogIds, ...clientBugLogIds])];
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
    baseSeq,
    serverLatestSeq: response.latestSeq ?? null,
    appliedCount: response.appliedCount ?? null,
  };
}

async function applyAtomicRejectedPushResponse(
  response: SyncPushResponse,
  changes: SyncChange[],
  sourceLogIdsByChangeKey: Map<string, string[]>,
  changeKey: (tableName: SyncChange["tableName"], recordId: string, action: SyncChange["action"]) => string,
  baseSeq: number | null,
): Promise<SyncPushResult> {
  const retryKeys = new Set(
    changes.map((change) => changeKey(change.tableName, change.recordId, change.action)),
  );
  const clientBugLogIds: string[] = [];
  const staleRejectedLogIds: string[] = [];
  const quarantineLogIds: string[] = [];
  const clientBugIssues: SyncPushOutcome[] = [];
  const userActionableIssues: SyncPushOutcome[] = [];
  const issues: SyncPushOutcome[] = [];

  for (const outcome of response.outcomes) {
    const key = changeKey(outcome.tableName, outcome.recordId, outcome.action);
    if (outcome.status === "accepted") {
      continue;
    }
    retryKeys.delete(key);

    const category = classifyReasonCode(outcome.reasonCode);
    const logIds = sourceLogIdsByChangeKey.get(key) ?? [];
    if (category === "client_bug") {
      clientBugLogIds.push(...logIds);
      clientBugIssues.push(outcome);
    } else if (category === "stale_rejected") {
      // 服务端拒收过期/孤儿主张：放弃本地主张，与 200 路径同语义。
      staleRejectedLogIds.push(...logIds);
      issues.push(outcome);
    } else {
      // 服务端会持续拒收同一载荷——隔离为死信（synced=2），不再逐轮重发引爆 409 拆批；
      // 用户修正记录会产生新日志（synced=0），自然重新进入上传队列。
      quarantineLogIds.push(...logIds);
      if (category === "user_actionable") userActionableIssues.push(outcome);
      issues.push(outcome);
    }
  }

  const markSynced = [...new Set([...clientBugLogIds, ...staleRejectedLogIds])];
  if (markSynced.length > 0) {
    await db.syncLog.bulkUpdate(markSynced.map((id) => ({ key: id, changes: { synced: 1 } })));
  }
  const markQuarantined = [...new Set(quarantineLogIds)].filter((id) => !markSynced.includes(id));
  if (markQuarantined.length > 0) {
    await db.syncLog.bulkUpdate(markQuarantined.map((id) => ({ key: id, changes: { synced: SYNC_LOG_QUARANTINED } })));
  }

  const retryChanges = changes.filter((change) => retryKeys.has(changeKey(change.tableName, change.recordId, change.action)));
  if (retryChanges.length === changes.length) {
    throw new Error("Invalid /api/sync/push 409 response: atomic rejection contains no rejected change");
  }

  let retryResult: SyncPushResult | null = null;
  if (retryChanges.length > 0) {
    retryResult = await submitPushBatch(retryChanges, sourceLogIdsByChangeKey, changeKey, baseSeq);
  }

  return {
    accepted: retryResult?.accepted ?? 0,
    rejected: response.rejected + (retryResult?.rejected ?? 0),
    conflicts: response.conflicts + (retryResult?.conflicts ?? 0),
    issues: [...issues, ...(retryResult?.issues ?? [])],
    clientBugIssues: [...clientBugIssues, ...(retryResult?.clientBugIssues ?? [])],
    userActionableIssues: [...userActionableIssues, ...(retryResult?.userActionableIssues ?? [])],
    baseSeq,
    serverLatestSeq: retryResult?.serverLatestSeq ?? response.latestSeq ?? null,
    appliedCount: retryResult?.appliedCount ?? response.appliedCount ?? 0,
  };
}

async function submitPushBatch(
  changes: SyncChange[],
  sourceLogIdsByChangeKey: Map<string, string[]>,
  changeKey: (tableName: SyncChange["tableName"], recordId: string, action: SyncChange["action"]) => string,
  baseSeq: number | null,
): Promise<SyncPushResult> {
  try {
    const response = await apiFetch<SyncPushResponse>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes, baseSeq }),
    });
    recordClockSkew(response.serverTime);
    return applyPushResponse(response, sourceLogIdsByChangeKey, changeKey, baseSeq);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && isSyncPushResponse(error.body)) {
      recordClockSkew(error.body.serverTime);
      return applyAtomicRejectedPushResponse(error.body, changes, sourceLogIdsByChangeKey, changeKey, baseSeq);
    }
    throw error;
  }
}

export async function syncPush(): Promise<SyncPushResult> {
  const baseSeq = getLastSyncedSeq();
  const unsynced = await db.syncLog.where("synced").equals(0).toArray();
  if (unsynced.length === 0) return { accepted: 0, rejected: 0, conflicts: 0, issues: [], clientBugIssues: [], userActionableIssues: [], baseSeq, serverLatestSeq: null, appliedCount: null };

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
        ...(log.deleteReason ? { deleteReason: log.deleteReason } : {}),
      } as SyncChange);
      continue;
    }

    const domain = CLIENT_SYNC_DOMAINS[log.tableName];
    if (!domain) continue;
    const data = await db.table(domain.storeName).get(storeKeyForRecordId(domain, log.recordId));
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
      ...(log.op ? { op: log.op } : {}),
    } as SyncChange);
  }

  if (changes.length === 0) {
    if (omittedLogIds.length > 0) {
      await db.syncLog.bulkUpdate(omittedLogIds.map((id) => ({ key: id, changes: { synced: 1 } })));
    }
    return { accepted: 0, rejected: 0, conflicts: 0, issues: [], clientBugIssues: [], userActionableIssues: [], baseSeq, serverLatestSeq: null, appliedCount: null };
  }

  const result = await submitPushBatch(changes, sourceLogIdsByChangeKey, changeKey, baseSeq);
  if (omittedLogIds.length > 0) {
    await db.syncLog.bulkUpdate(omittedLogIds.map((id) => ({ key: id, changes: { synced: 1 } })));
  }
  return result;
}

export async function syncPullSinceSeq(): Promise<{ applied: number; conflicts: SyncConflict[] }> {
  const startSeq = buildPullCursor("incremental").sinceSeq;

  let applied = 0;
  const conflicts: SyncConflict[] = [];
  const protectedCascadeRecords = new Set<string>();

  const last = await fetchPullBatches(startSeq, async (response) => {
    const batchConflicts: SyncConflict[] = [];
    let batchApplied = 0;
    await db.transaction("rw", pullBatchTables(response), async () => {
      // pending 检查和远端 apply 同处一个事务；并发本地写入只能发生在事务之前或之后。
      const unsyncedLogs = await db.syncLog.where("synced").equals(0).toArray();
      const pendingByRecord = groupPendingLogs(unsyncedLogs);
      const categoryDeleteIds = response.changes
        .filter((change) => change.tableName === "categories" && change.action === "delete")
        .map((change) => change.recordId);
      const categoryDeleteImpacts = await getCategoryDeleteImpacts(categoryDeleteIds);
      const blockedCategoryDeletes = new Map<string, {
        impact: CategoryDeleteImpact;
        localLog: SyncLogEntry;
        sourceLogIds: string[];
      }>();

      for (const [categoryId, impact] of categoryDeleteImpacts) {
        if (protectedCascadeRecords.has(syncRecordKey("categories", categoryId))) continue;
        const nestedUnderAnotherDelete = [...categoryDeleteImpacts.entries()].some(
          ([otherId, otherImpact]) => otherId !== categoryId && otherImpact.categoryIds.includes(categoryId),
        );
        if (nestedUnderAnotherDelete) continue;
        const sourceLogIds = [
          ...impact.categoryIds.flatMap((id) => pendingLogsForRecord(pendingByRecord, "categories", id).map((log) => log.id)),
          ...impact.entryIds.flatMap((id) => pendingLogsForRecord(pendingByRecord, "time_entries", id).map((log) => log.id)),
        ];
        if (sourceLogIds.length === 0) continue;
        const localLog = unsyncedLogs.find((log) => sourceLogIds.includes(log.id));
        if (!localLog) continue;
        blockedCategoryDeletes.set(categoryId, { impact, localLog, sourceLogIds });
        for (const id of impact.categoryIds) protectedCascadeRecords.add(syncRecordKey("categories", id));
        for (const id of impact.entryIds) protectedCascadeRecords.add(syncRecordKey("time_entries", id));
      }

      for (const change of response.changes) {
        const blockedCategoryDelete = change.tableName === "categories" && change.action === "delete"
          ? blockedCategoryDeletes.get(change.recordId)
          : undefined;
        if (blockedCategoryDelete) {
          batchConflicts.push({
            tableName: "categories",
            recordId: change.recordId,
            local: blockedCategoryDelete.impact.target,
            remote: null,
            remoteAction: "delete",
            localLog: blockedCategoryDelete.localLog,
            sourceLogIds: blockedCategoryDelete.sourceLogIds,
          });
          continue;
        }
        if (protectedCascadeRecords.has(syncRecordKey(change.tableName, change.recordId))) continue;

        const domain = CLIENT_SYNC_DOMAINS[change.tableName];
        if (!domain) continue;
        const sharedDomain = getSyncDomain(change.tableName);
        const store = db.table(domain.storeName);
        const pendingLogs = pendingLogsForRecord(pendingByRecord, change.tableName, change.recordId);
        const localLog = pendingLogs.at(-1);
        const sourceLogIds = pendingLogs.map((log) => log.id);

        if (change.action === "delete") {
          if (domain.applyRemoteDelete) {
            const impact = categoryDeleteImpacts.get(change.recordId);
            if (!impact) continue;
            const cascadeSourceLogIds = [
              ...impact.categoryIds.flatMap((id) => pendingLogsForRecord(pendingByRecord, "categories", id).map((log) => log.id)),
              ...impact.entryIds.flatMap((id) => pendingLogsForRecord(pendingByRecord, "time_entries", id).map((log) => log.id)),
            ];
            const cascadeLocalLog = unsyncedLogs.find((log) => cascadeSourceLogIds.includes(log.id));
            if (cascadeLocalLog) {
              batchConflicts.push({
                tableName: change.tableName as SyncConflict["tableName"],
                recordId: change.recordId,
                local: impact.target as SyncConflict["local"],
                remote: null,
                remoteAction: "delete",
                localLog: cascadeLocalLog,
                sourceLogIds: cascadeSourceLogIds,
              });
            } else {
              batchApplied += await domain.applyRemoteDelete(change.recordId);
            }
            continue;
          }

          const key = storeKeyForRecordId(domain, change.recordId);
          const existing = await store.get(key);
          if (!existing) continue;
          if (sharedDomain.conflictPolicy === "manual") {
            if (localLog) {
              batchConflicts.push({
                tableName: change.tableName as SyncConflict["tableName"],
                recordId: change.recordId,
                local: existing as SyncConflict["local"],
                remote: null,
                remoteAction: "delete",
                localLog,
                sourceLogIds,
              });
            } else {
              await store.delete(key);
              batchApplied++;
            }
          } else if (!localLog) {
            await store.delete(key);
            batchApplied++;
          }
          continue;
        }

        if (!change.data) continue;
        const remote = parseRemoteRecord(domain, change.data, change.recordId);
        if (!remote) continue;
        const existing = await store.get(storeKeyForRecordId(domain, change.recordId));

        if (sharedDomain.conflictPolicy === "manual") {
          if (localLog) {
            if (existing && (existing as { updatedAt: string }).updatedAt !== (remote as { updatedAt: string }).updatedAt) {
              batchConflicts.push({
                tableName: change.tableName as SyncConflict["tableName"],
                recordId: change.recordId,
                local: existing as SyncConflict["local"],
                remote: remote as SyncConflict["remote"],
                remoteAction: "update",
                localLog,
                sourceLogIds,
              });
            }
            continue;
          }
          if (!existing || (existing as { updatedAt: string }).updatedAt !== (remote as { updatedAt: string }).updatedAt) {
            await store.put(remote);
            batchApplied++;
          }
        } else if (!localLog) {
          const shouldApply = domain.needsApply
            ? domain.needsApply(existing, remote)
            : !existing || (existing as { updatedAt: string }).updatedAt !== (remote as { updatedAt: string }).updatedAt;
          if (shouldApply) {
            await store.put(remote);
            batchApplied++;
          }
        }
      }
    });
    applied += batchApplied;
    conflicts.push(...batchConflicts);
  });

  advanceSeqCursor(last); // 末批收尾兜底到 latestSeq
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
  const unsyncedCount = await db.syncLog.where("synced").equals(0).count();
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
  const forcePushTables = new Set<SyncLogEntry["tableName"]>([
    "categories",
    "time_entries",
    "settings",
    "quick_notes",
    "tasks",
  ]);
  const snapshot = await db.transaction(
    "r",
    [db.categories, db.timeEntries, db.settings, db.quickNotes, db.tasks, db.syncLog],
    async () => {
      const [categories, timeEntries, settings, quickNotes, tasks, pendingLogs] = await Promise.all([
        db.categories.toArray(),
        db.timeEntries.toArray(),
        db.settings.toArray(),
        db.quickNotes.toArray(),
        db.tasks.toArray(),
        db.syncLog.where("synced").equals(0).toArray(),
      ]);
      return {
        categories,
        timeEntries,
        settings,
        quickNotes,
        tasks,
        sourceLogIds: pendingLogs.filter((log) => forcePushTables.has(log.tableName)).map((log) => log.id),
      };
    },
  );

  const response = await apiFetch<SyncForcePushResponse>("/api/sync/force-push", {
    method: "POST",
    body: JSON.stringify({
      confirmToken,
      confirmationPhrase,
      categories: snapshot.categories,
      timeEntries: snapshot.timeEntries,
      settings: snapshot.settings,
      quickNotes: snapshot.quickNotes,
      tasks: snapshot.tasks,
    }),
  });

  if (snapshot.sourceLogIds.length > 0) {
    await db.syncLog.bulkUpdate(
      snapshot.sourceLogIds.map((id) => ({ key: id, changes: { synced: 1 } })),
    );
  }
  advanceSeqCursor(response);
  return response;
}

async function reportToServer(logs: Array<{ action: string; detail?: string; record_count?: number }>): Promise<void> {
  try {
    const device = getDeviceName();
    await apiFetch("/api/admin/sync-logs", {
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
  if (regularSyncInFlight) return regularSyncInFlight;
  regularSyncInFlight = runRegularSync(options).finally(() => {
    regularSyncInFlight = null;
  });
  return regularSyncInFlight;
}

async function runRegularSync(options: RegularSyncOptions = {}): Promise<RegularSyncResult> {
  const rec = options.phases;
  try {
    const unsyncedCount = await db.syncLog.where("synced").equals(0).count();

    if (unsyncedCount === 0) {
      // 无 pending：status 预查仅在此路径保留，承担 no-op 判定。
      // contentHash 不再参与主路径，仅保留在 getSyncHealth() 诊断工具里做深度体检。
      const serverStatus = rec
        ? await rec.time("status", () => apiFetch<SyncStatusResponse>("/api/sync/status", { hedge: SYNC_HEDGE }))
        : await apiFetch<SyncStatusResponse>("/api/sync/status", { hedge: SYNC_HEDGE });
      recordClockSkew(serverStatus.serverTime);
      const serverSeq = serverStatus.latestSeq ?? 0;
      const localSeq = getLastSyncedSeq() ?? 0;
      if (serverSeq < localSeq) {
        throw new Error(`同步账本异常：服务器序号 ${serverSeq} 低于本地序号 ${localSeq}，请先执行全量拉取或检查服务器数据恢复状态。`);
      }
      if (serverSeq === localSeq) {
        resetConsecutiveSyncFailures();
        return {
          checked: true,
          identical: true,
          pushed: 0,
          rejected: 0,
          pushConflicts: 0,
          pushIssues: [],
          pulled: 0,
          conflicts: [],
        };
      }

      const { applied, conflicts } = rec ? await rec.time("pull", () => syncPullSinceSeq()) : await syncPullSinceSeq();
      const logs: Array<{ action: string; detail?: string; record_count?: number }> = [
        { action: "pull_seq_catchup", record_count: applied },
      ];
      if (rec) logs.push({ action: "phase_timings", detail: JSON.stringify(rec.phases), record_count: 0 });
      void reportToServer(logs); // fire-and-forget：不 await，不计入 syncing 窗口
      resetConsecutiveSyncFailures();
      void pruneSyncedLogs().catch(() => undefined); // 清理失败不应算作整轮同步失败，也不占同步窗口
      return {
        checked: true,
        identical: false,
        pushed: 0,
        rejected: 0,
        pushConflicts: 0,
        pushIssues: [],
        pulled: applied,
        conflicts,
      };
    }

    // 有 pending（写后路径）：跳过 status——它唯一的用途是 no-op 判定，此处恒不成立；
    // 冲突分析在服务端 baseSeq 逻辑里，push 后回声 pull 追平。
    const pushResult = rec ? await rec.time("push", () => syncPush()) : await syncPush();

    let applied = 0;
    let conflicts: SyncConflict[] = [];
    let pullSkipped = false;
    if (canSkipEchoPull(pushResult) && pushResult.serverLatestSeq != null) {
      setLastSyncedSeq(pushResult.serverLatestSeq); // 无插队：本地即最新，直接推游标
      pullSkipped = true;
    } else {
      const pulled = rec ? await rec.time("pull", () => syncPullSinceSeq()) : await syncPullSinceSeq();
      applied = pulled.applied;
      conflicts = pulled.conflicts;
    }

    const logs: Array<{ action: string; detail?: string; record_count?: number }> = [
      { action: "push", record_count: pushResult.accepted },
      { action: pullSkipped ? "pull_skipped_no_intervening" : "pull_since_seq", record_count: applied },
    ];

    if (conflicts.length > 0) {
      logs.push({ action: "conflict", detail: describeConflicts(conflicts), record_count: conflicts.length });
    }

    if (rec) logs.push({ action: "phase_timings", detail: JSON.stringify(rec.phases), record_count: 0 });

    void reportToServer(logs);
    resetConsecutiveSyncFailures();
    void pruneSyncedLogs().catch(() => undefined); // 清理失败不应算作整轮同步失败，也不占同步窗口
    return {
      checked: true,
      identical: false,
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
  const startSeq = buildPullCursor(mode).sinceSeq;

  let applied = 0;
  const protectedCascadeRecords = new Set<string>();

  const last = await fetchPullBatches(startSeq, async (response) => {
    let batchApplied = 0;
    await db.transaction("rw", pullBatchTables(response), async () => {
      const pendingByRecord = groupPendingLogs(await db.syncLog.where("synced").equals(0).toArray());
      const categoryDeleteIds = response.changes
        .filter((change) => change.tableName === "categories" && change.action === "delete")
        .map((change) => change.recordId);
      const categoryDeleteImpacts = await getCategoryDeleteImpacts(categoryDeleteIds);

      for (const impact of categoryDeleteImpacts.values()) {
        const hasPending = impact.categoryIds.some(
          (id) => pendingLogsForRecord(pendingByRecord, "categories", id).length > 0,
        ) || impact.entryIds.some(
          (id) => pendingLogsForRecord(pendingByRecord, "time_entries", id).length > 0,
        );
        if (!hasPending) continue;
        for (const id of impact.categoryIds) protectedCascadeRecords.add(syncRecordKey("categories", id));
        for (const id of impact.entryIds) protectedCascadeRecords.add(syncRecordKey("time_entries", id));
      }

      for (const change of response.changes) {
        const domain = CLIENT_SYNC_DOMAINS[change.tableName];
        if (!domain) continue;
        if (protectedCascadeRecords.has(syncRecordKey(change.tableName, change.recordId))) continue;
        if (pendingLogsForRecord(pendingByRecord, change.tableName, change.recordId).length > 0) continue;
        const store = db.table(domain.storeName);

        if (change.action === "delete") {
          if (domain.applyRemoteDelete) {
            batchApplied += await domain.applyRemoteDelete(change.recordId);
          } else {
            const key = storeKeyForRecordId(domain, change.recordId);
            const existing = await store.get(key);
            if (existing) {
              await store.delete(key);
              batchApplied++;
            }
          }
        } else if (change.data) {
          const remote = parseRemoteRecord(domain, change.data, change.recordId);
          if (!remote) continue;
          const existing = await store.get(storeKeyForRecordId(domain, change.recordId));

          if (mode === "repair" && existing && domain.shouldSkipOnRepair?.(existing, remote)) {
            continue;
          }

          const shouldApply = domain.needsApply
            ? domain.needsApply(existing, remote)
            : !existing || (existing as { updatedAt: string }).updatedAt !== (remote as { updatedAt: string }).updatedAt;
          if (shouldApply) {
            await store.put(remote);
            batchApplied++;
          }
        }
      }
    });
    applied += batchApplied;
  });

  advanceSeqCursor(last); // 末批收尾兜底到 latestSeq
  return applied;
}

export async function recordSyncLog(
  tableName: SyncLogEntry["tableName"],
  recordId: string,
  action: "create" | "update" | "delete",
  timestamp = new Date().toISOString(),
  op?: SyncLogEntry["op"],
  deleteReason?: SyncLogEntry["deleteReason"],
): Promise<void> {
  await db.syncLog.add({
    id: uuid(),
    tableName,
    recordId,
    action,
    timestamp,
    synced: 0,
    ...(op ? { op } : {}),
    ...(deleteReason ? { deleteReason } : {}),
  });
  syncScheduler.notifyWrite();
}

export async function recordSyncLogs(
  entries: Array<{
    tableName: SyncLogEntry["tableName"];
    recordId: string;
    action: "create" | "update" | "delete";
    timestamp?: string;
  }>,
): Promise<void> {
  if (entries.length === 0) return;
  const fallbackTimestamp = new Date().toISOString();
  await db.syncLog.bulkAdd(
    entries.map((entry) => ({
      id: uuid(),
      tableName: entry.tableName,
      recordId: entry.recordId,
      action: entry.action,
      timestamp: entry.timestamp ?? fallbackTimestamp,
      synced: 0,
    })),
  );
  syncScheduler.notifyWrite();
}

// 已同步/已隔离日志仅剩审计残值，保留 7 天便于排障后即清，防止 IndexedDB 无界膨胀。
export const SYNCED_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function pruneSyncedLogs(now: () => number = Date.now): Promise<number> {
  const cutoff = new Date(now() - SYNCED_LOG_RETENTION_MS).toISOString();
  return db.syncLog
    .where("synced")
    .anyOf(1, SYNC_LOG_QUARANTINED)
    .filter((log) => log.timestamp < cutoff)
    .delete();
}

export async function getQuarantinedSyncLogs(): Promise<SyncLogEntry[]> {
  return db.syncLog.where("synced").equals(SYNC_LOG_QUARANTINED).toArray();
}

/** 把隔离的死信日志重新放回上传队列（用户修正服务端拒因后手动重试的出口）。 */
export async function requeueQuarantinedSyncLogs(ids?: string[]): Promise<number> {
  const targets = ids ?? (await getQuarantinedSyncLogs()).map((log) => log.id);
  if (targets.length === 0) return 0;
  await db.syncLog.bulkUpdate(targets.map((id) => ({ key: id, changes: { synced: 0 } })));
  syncScheduler.notifyWrite();
  return targets.length;
}
