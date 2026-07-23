import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import crypto from "node:crypto";
import {
  SYNC_DOMAINS,
  SyncForcePushPrepareRequestSchema,
  SyncForcePushRequestSchema,
  SyncPullRequestSchema,
  SyncPushRequestSchema,
} from "@timedata/shared";
import type {
  Category,
  QuickNote,
  SyncChange,
  SyncForcePushPrepareRequest,
  SyncForcePushPrepareResponse,
  SyncForcePushRequest,
  SyncForcePushResponse,
  SyncPullResponse,
  SyncPushOutcome,
  SyncPushResponse,
  SyncStatusResponse,
  Setting,
  Task,
  TimeEntry,
} from "@timedata/shared";
import { getDb } from "../db/connection.js";
import type { CountRow, MaxRow, TombstoneRow } from "../lib/db-rows.js";
import { errorJson, ErrorCode } from "../lib/errors.js";
import { createServerBackup } from "../sync/backup.js";
import type { Database } from "better-sqlite3";
import {
  getServerDomain,
  predictChangeImpactRecords,
  predictOverlappingDeletions,
} from "../sync/domains.js";
import { applyChange, captureServerTimestamps, type ApplyChangeResult } from "../sync/resolver.js";
import { orderPushChanges } from "../sync/order.js";
import { validateSyncChanges } from "../sync/validation.js";
import { analyzePushBaseSeq } from "../sync/conflict.js";
import { validateForcePushBusinessRules } from "../sync/forcePushValidation.js";
import { getChangesSinceSeq, getLatestSeq } from "../sync/seq.js";
import { getCommitHash } from "../sync/state.js";
import { addSyncStreamListener, notifySyncChange, removeSyncStreamListener, type SyncStreamListener } from "../sync/notifier.js";

const FORCE_PUSH_CONFIRMATION_PHRASE = "OVERWRITE_SERVER" as const;
const FORCE_PUSH_TOKEN_TTL_MS = 5 * 60 * 1000;
const STREAM_HEARTBEAT_MS = 30_000;

interface ForcePushTokenRecord {
  expiresAt: number;
  localSummary: SyncForcePushPrepareRequest;
}

const forcePushTokens = new Map<string, ForcePushTokenRecord>();

type ForcePushTokenLookup =
  | { status: "valid"; record: ForcePushTokenRecord }
  | { status: "expired" }
  | { status: "missing" };

function pruneForcePushTokens(now = Date.now()): void {
  for (const [token, record] of forcePushTokens.entries()) {
    if (record.expiresAt <= now) forcePushTokens.delete(token);
  }
}

function createForcePushToken(localSummary: SyncForcePushPrepareRequest, now = Date.now()): { token: string; expiresAt: Date } {
  pruneForcePushTokens(now);
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now + FORCE_PUSH_TOKEN_TTL_MS);
  forcePushTokens.set(token, { expiresAt: expiresAt.getTime(), localSummary });
  return { token, expiresAt };
}

function consumeForcePushToken(token: string, now = Date.now()): ForcePushTokenLookup {
  const record = forcePushTokens.get(token);
  if (!record) return { status: "missing" };
  if (record.expiresAt <= now) {
    forcePushTokens.delete(token);
    return { status: "expired" };
  }
  forcePushTokens.delete(token);
  return { status: "valid", record };
}

function validateForcePushPayload(body: SyncForcePushRequest): string | null {
  return validateForcePushBusinessRules(body.categories, body.timeEntries, body.quickNotes, body.tasks);
}

function forcePushChanges(
  db: Database,
  categories: Category[],
  timeEntries: TimeEntry[],
  quickNotes: QuickNote[],
  tasks: Task[],
  settings?: Setting[],
): SyncChange[] {
  const forcedAt = new Date().toISOString();
  const changes: SyncChange[] = [];

  function appendChange<RecordType>(
    tableName: SyncChange["tableName"],
    recordId: string,
    action: "create" | "update",
    record: RecordType,
    opOf?: (record: RecordType) => Record<string, unknown> | undefined,
  ): void {
    changes.push({
      tableName,
      recordId,
      action,
      data: record,
      timestamp: forcedAt,
      ...(opOf?.(record) ?? {}),
    } as SyncChange);
  }

  function appendSnapshot<RecordType>(
    tableName: SyncChange["tableName"],
    idColumn: string,
    records: RecordType[],
    recordIdOf: (record: RecordType) => string,
    opOf?: (record: RecordType) => Record<string, unknown> | undefined,
  ): void {
    const existingIds = new Set(
      (db.prepare(`SELECT ${idColumn} AS id FROM ${tableName}`).all() as Array<{ id: string }>).map((row) => row.id),
    );
    const incomingIds = new Set(records.map(recordIdOf));

    for (const recordId of existingIds) {
      if (incomingIds.has(recordId)) continue;
      changes.push({ tableName, recordId, action: "delete", data: null, timestamp: forcedAt } as SyncChange);
    }
    for (const record of records) {
      const recordId = recordIdOf(record);
      appendChange(tableName, recordId, existingIds.has(recordId) ? "update" : "create", record, opOf);
    }
  }

  const existingCategories = db
    .prepare("SELECT id, parent_id FROM categories")
    .all() as Array<{ id: string; parent_id: string | null }>;
  const incomingCategoryIds = new Set(categories.map((category) => category.id));
  const deletedCategoryIds = new Set(
    existingCategories.filter((category) => !incomingCategoryIds.has(category.id)).map((category) => category.id),
  );
  for (const category of existingCategories) {
    if (!deletedCategoryIds.has(category.id)) continue;
    if (category.parent_id && deletedCategoryIds.has(category.parent_id)) continue;
    changes.push({
      tableName: "categories",
      recordId: category.id,
      action: "delete",
      data: null,
      timestamp: forcedAt,
    });
  }
  const existingCategoryIds = new Set(existingCategories.map((category) => category.id));
  for (const category of categories) {
    appendChange(
      "categories",
      category.id,
      existingCategoryIds.has(category.id) ? "update" : "create",
      category,
    );
  }

  const existingEntries = db
    .prepare("SELECT id, category_id FROM time_entries")
    .all() as Array<{ id: string; category_id: string }>;
  const incomingEntryIds = new Set(timeEntries.map((entry) => entry.id));
  for (const entry of existingEntries) {
    if (incomingEntryIds.has(entry.id) || deletedCategoryIds.has(entry.category_id)) continue;
    changes.push({
      tableName: "time_entries",
      recordId: entry.id,
      action: "delete",
      data: null,
      timestamp: forcedAt,
    });
  }
  const existingEntryIds = new Set(existingEntries.map((entry) => entry.id));
  for (const entry of timeEntries) {
    appendChange(
      "time_entries",
      entry.id,
      existingEntryIds.has(entry.id) ? "update" : "create",
      entry,
    );
  }

  if (settings !== undefined) appendSnapshot("settings", "key", settings, (setting) => setting.key);
  appendSnapshot("quick_notes", "id", quickNotes, (note) => note.id);
  appendSnapshot("tasks", "id", tasks, (task) => task.id, () => ({ op: { type: "amend", at: forcedAt } }));

  return orderPushChanges(changes);
}

// SyncStatusResponse 的字段名是公开契约，登记簿表名经映射输出，本轮不改响应形状。
const STATUS_COUNT_FIELDS: Record<string, "categoryCount" | "entryCount" | "quickNoteCount"> = {
  categories: "categoryCount",
  time_entries: "entryCount",
  quick_notes: "quickNoteCount",
};

function readServerStatus(db: Database): SyncStatusResponse {
  const counts: Record<"categoryCount" | "entryCount" | "quickNoteCount", number> = {
    categoryCount: 0,
    entryCount: 0,
    quickNoteCount: 0,
  };
  const latestValues: Array<string | null> = [];
  for (const domain of SYNC_DOMAINS) {
    // 表名来自登记簿常量，不是用户输入。
    const field = STATUS_COUNT_FIELDS[domain.table];
    if (domain.countsInStatus && field) {
      counts[field] = (db.prepare(`SELECT COUNT(*) as count FROM ${domain.table}`).get() as CountRow).count;
    }
    latestValues.push((db.prepare(`SELECT MAX(updated_at) as value FROM ${domain.table}`).get() as MaxRow).value);
  }
  const lastUpdatedAt = latestValues.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  const commitState = getCommitHash(db);

  return {
    ...counts,
    lastUpdatedAt,
    contentHash: commitState.hash,
    latestSeq: commitState.latestSeq,
    serverTime: new Date().toISOString(),
  };
}

const sync = new Hono();

const SYNC_LOG_DETAIL_MAX = 4096;

function writeSyncLog(db: Database, action: string, detail: unknown, recordCount = 0): void {
  let serialized = typeof detail === "string" ? detail : JSON.stringify(detail);
  if (serialized.length > SYNC_LOG_DETAIL_MAX) {
    serialized = `${serialized.slice(0, SYNC_LOG_DETAIL_MAX - 16)}...[truncated]`;
  }
  db.prepare("INSERT INTO sync_logs (device, action, detail, record_count) VALUES (?, ?, ?, ?)").run(
    "server",
    action,
    serialized,
    recordCount,
  );
}

function syncPushResponse(
  outcomes: SyncPushOutcome[],
  backupId: string | null,
  latestSeq: number | null,
  appliedCount: number,
): SyncPushResponse {
  return {
    outcomes,
    accepted: outcomes.filter((r) => r.status === "accepted").length,
    rejected: outcomes.filter((r) => r.status === "rejected").length,
    conflicts: outcomes.filter((r) => r.status === "conflict").length,
    backupId,
    serverTime: new Date().toISOString(),
    latestSeq,
    appliedCount,
  };
}

// push 幂等：并发窗口说明——正常路径 parse 后到响应之间无 await、better-sqlite3 同步执行，
// 同 requestId 的重复请求天然串行，第二个请求总会命中回放表（无需内存锁）；
// 唯一有 await 窗口的是危险备份路径（createServerBackup），但该窗口已有 seq 竞态守卫（push_retry_after_backup_race）
// 兜底会拒收成 409，且备份路径本就不落回放行——所以此处不加内存锁（YAGNI）。
function prunePushRequestReplays(db: Database): void {
  db.prepare("DELETE FROM sync_push_requests WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')").run();
}

function storePushRequestReplay(db: Database, requestId: string | undefined, statusCode: 200 | 409, response: SyncPushResponse): void {
  if (!requestId) return;
  db.prepare("INSERT OR IGNORE INTO sync_push_requests (request_id, status_code, response_json) VALUES (?, ?, ?)")
    .run(requestId, statusCode, JSON.stringify(response));
}

function seqAnalysisBackupDetails(
  baseSeq: number | null,
  analysis: ReturnType<typeof analyzePushBaseSeq>,
  changes: SyncChange[],
): Record<string, unknown> {
  return {
    baseSeq,
    cloudAheadCount: analysis.cloudAheadCount,
    overlappingRecords: analysis.overlappingRecords,
    pushedRecords: changes.map((change) => ({ tableName: change.tableName, recordId: change.recordId, action: change.action })),
  };
}

function protectedOutcomeIds(outcomes: SyncPushOutcome[]): string[] {
  return outcomes.flatMap((outcome) => outcome.overriddenRecordIds ?? []);
}

function outcomeFromApplyResult(result: ApplyChangeResult, backupId: string | null): SyncPushOutcome {
  return {
    tableName: result.tableName,
    recordId: result.recordId,
    action: result.action,
    status: result.status === "applied" ? "accepted" : "conflict",
    reasonCode: result.status === "applied" ? "applied" : (result.skipReason ?? "server_version_newer_or_same"),
    message: result.reason,
    incomingTimestamp: result.incomingTimestamp,
    serverUpdatedAt: result.serverUpdatedAt,
    overriddenRecordIds: result.overriddenRecordIds,
    backupId: result.overriddenRecordIds?.length ? (backupId ?? undefined) : undefined,
  };
}

sync.get("/status", (c) => {
  const db = getDb();
  return c.json(readServerStatus(db));
});

sync.get("/stream", (c) => {
  c.header("X-Accel-Buffering", "no"); // nginx 读上游头关闭代理缓冲，SSE 逐条直达
  return streamSSE(c, async (stream) => {
    let ready = false;
    let pendingLatestSeq: number | null = null;
    const listener: SyncStreamListener = (bump) => {
      if (!ready) {
        // hello 前的缓冲只保留最高 latestSeq、丢载荷：补发退化为纯 bump，客户端走 pull 追平。
        pendingLatestSeq =
          pendingLatestSeq == null || (bump.latestSeq != null && bump.latestSeq > pendingLatestSeq)
            ? bump.latestSeq
            : pendingLatestSeq;
        return;
      }
      void stream.writeSSE({ event: "bump", data: JSON.stringify(bump) }).catch(() => undefined);
    };
    addSyncStreamListener(listener);
    stream.onAbort(() => removeSyncStreamListener(listener));

    try {
      const helloLatestSeq = getLatestSeq();
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ latestSeq: helloLatestSeq }) });
      ready = true;
      if (pendingLatestSeq != null && pendingLatestSeq > (helloLatestSeq ?? 0)) {
        await stream.writeSSE({ event: "bump", data: JSON.stringify({ latestSeq: pendingLatestSeq }) });
      }
      while (true) {
        await stream.sleep(STREAM_HEARTBEAT_MS);
        await stream.write(": ping\n\n");
      }
    } finally {
      removeSyncStreamListener(listener);
    }
  });
});

sync.post("/force-push/prepare", async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = SyncForcePushPrepareRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, undefined, { issues: parsed.error.issues });
    return c.json(body, status);
  }

  const body = parsed.data;
  const db = getDb();
  const { token, expiresAt } = createForcePushToken({
    categoryCount: Number(body.categoryCount || 0),
    entryCount: Number(body.entryCount || 0),
    quickNoteCount: Number(body.quickNoteCount || 0),
    lastUpdatedAt: typeof body.lastUpdatedAt === "string" ? body.lastUpdatedAt : null,
  });

  const response: SyncForcePushPrepareResponse = {
    confirmToken: token,
    expiresAt: expiresAt.toISOString(),
    confirmationPhrase: FORCE_PUSH_CONFIRMATION_PHRASE,
    serverStatus: readServerStatus(db),
  };

  writeSyncLog(db, "force_push_prepare", {
    local: body,
    server: response.serverStatus,
    expiresAt: response.expiresAt,
  });

  return c.json(response);
});

sync.post("/force-push", async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = SyncForcePushRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, undefined, { issues: parsed.error.issues });
    return c.json(body, status);
  }

  const body = parsed.data;
  const db = getDb();
  if (body.confirmationPhrase !== FORCE_PUSH_CONFIRMATION_PHRASE) {
    writeSyncLog(db, "force_push_rejected", { reason: "invalid_phrase" });
    const { body: errBody, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, "Invalid force-push confirmation phrase.");
    return c.json(errBody, status);
  }

  const tokenRecord = consumeForcePushToken(body.confirmToken || "", Date.now());
  if (tokenRecord.status === "expired") {
    writeSyncLog(db, "force_push_expired", { reason: "expired_token" });
    const { body: errBody, status } = errorJson(ErrorCode.INVALID_REQUEST, 403, "Invalid or expired force-push confirmation token.");
    return c.json(errBody, status);
  }
  if (tokenRecord.status === "missing") {
    writeSyncLog(db, "force_push_rejected", { reason: "missing_token" });
    const { body: errBody, status } = errorJson(ErrorCode.INVALID_REQUEST, 403, "Invalid or expired force-push confirmation token.");
    return c.json(errBody, status);
  }

  const validationError = validateForcePushPayload(body);
  if (validationError) {
    const { body: errBody, status } = errorJson(ErrorCode.INVALID_BODY, 400, validationError);
    return c.json(errBody, status);
  }

  const seqBeforeBackup = getLatestSeq() ?? 0;
  const backup = await createServerBackup("sync_force_push", {
    protected: true,
    reason: "force_push_overwrite",
    details: {
      localSummary: tokenRecord.record.localSummary,
      importedCategories: body.categories.length,
      importedTimeEntries: body.timeEntries.length,
      importedSettings: body.settings?.length ?? 0,
      importedQuickNotes: body.quickNotes.length,
      importedTasks: body.tasks.length,
    },
  });

  if ((getLatestSeq() ?? 0) !== seqBeforeBackup) {
    writeSyncLog(db, "force_push_rejected", {
      reason: "server_changed_during_backup",
      backupId: backup.id,
      seqBeforeBackup,
      latestSeq: getLatestSeq(),
    });
    const { body: errBody, status } = errorJson(
      ErrorCode.CONFLICT,
      409,
      "Server data changed while the safety backup was being created. Prepare force-push again.",
      { backupId: backup.id },
    );
    return c.json(errBody, status);
  }

  const applyForcePush = db.transaction(() => {
    const changes = forcePushChanges(
      db,
      body.categories,
      body.timeEntries,
      body.quickNotes,
      body.tasks,
      body.settings,
    );
    for (const change of changes) {
      const result = applyChange(change, { db });
      if (result.status !== "applied") {
        throw new Error(`force-push could not apply ${change.tableName}:${change.recordId}: ${result.reason}`);
      }
    }
  });

  try {
    applyForcePush();
  } catch (err) {
    const message = (err as Error).message;
    console.error("[sync/force-push] apply failed:", message);
    writeSyncLog(
      db,
      "force_push_failed_after_backup",
      { backupId: backup.id, message },
      body.categories.length + body.timeEntries.length + body.quickNotes.length + body.tasks.length,
    );
    const { body: errBody, status } = errorJson(
      ErrorCode.INTERNAL_ERROR,
      500,
      undefined,
      { backupId: backup.id },
    );
    return c.json(errBody, status);
  }

  const response: SyncForcePushResponse = {
    importedCategories: body.categories.length,
    importedTimeEntries: body.timeEntries.length,
    importedSettings: body.settings?.length ?? 0,
    importedQuickNotes: body.quickNotes.length,
    importedTasks: body.tasks.length,
    backupId: backup.id,
    serverTime: new Date().toISOString(),
    latestSeq: getLatestSeq(),
  };

  writeSyncLog(db, "force_push_applied", {
    backupId: backup.id,
    localSummary: tokenRecord.record.localSummary,
    importedCategories: response.importedCategories,
    importedTimeEntries: response.importedTimeEntries,
    importedSettings: response.importedSettings,
    importedQuickNotes: response.importedQuickNotes,
    importedTasks: response.importedTasks,
  }, body.categories.length + body.timeEntries.length + body.quickNotes.length + body.tasks.length + (body.settings?.length ?? 0));

  notifySyncChange(getLatestSeq());
  return c.json(response);
});

sync.post("/backup", async (c) => {
  const backup = await createServerBackup("manual", { protected: true, reason: "manual" });
  return c.json({ backupId: backup.id });
});

sync.post("/push", async (c) => {
  const t0 = performance.now();
  const rawBody: unknown = await c.req.json();
  const parsed = SyncPushRequestSchema.safeParse(rawBody);
  const parseMs = performance.now() - t0;
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, undefined, { issues: parsed.error.issues });
    return c.json(body, status);
  }

  const body = parsed.data;
  const db = getDb();

  // 幂等命中：同 requestId 直接回放原响应，不重复校验/apply、不产生新 seq。
  if (body.requestId) {
    prunePushRequestReplays(db);
    const cached = db
      .prepare("SELECT status_code, response_json FROM sync_push_requests WHERE request_id = ?")
      .get(body.requestId) as { status_code: number; response_json: string } | undefined;
    if (cached) {
      writeSyncLog(db, "push_replayed", { requestId: body.requestId, statusCode: cached.status_code }, 0);
      return c.json(JSON.parse(cached.response_json) as SyncPushResponse, cached.status_code === 409 ? 409 : 200);
    }
  }

  const validateStart = performance.now();
  const orderedChanges = orderPushChanges(body.changes);
  const validation = validateSyncChanges(db, orderedChanges);
  const validateMs = performance.now() - validateStart;

  if (!validation.valid) {
    const response = syncPushResponse(validation.outcomes, null, getLatestSeq(), 0);
    writeSyncLog(
      db,
      "push_rejected",
      {
        timings: { parseMs: Math.round(parseMs), validateMs: Math.round(validateMs) },
        outcomes: response.outcomes,
      },
      response.outcomes.length,
    );
    storePushRequestReplay(db, body.requestId, 409, response);
    return c.json(response, 409);
  }

  const analyzeBackupStart = performance.now();
  const impactRecordsByChange = orderedChanges.map((change) => predictChangeImpactRecords(db, change));
  const pushRecords = [
    ...new Map(
      impactRecordsByChange
        .flat()
        .map((record) => [`${record.tableName}:${record.recordId}`, record]),
    ).values(),
  ];
  const seqAnalysis = analyzePushBaseSeq(body.baseSeq ?? null, pushRecords, db);
  const staleGuardKeys = new Set(
    seqAnalysis.overlappingRecords.map((record) => `${record.tableName}:${record.recordId}`),
  );
  const staleGuardAll = seqAnalysis.strategy === "unknown_base";
  let backupReason: string | null = null;
  let backupOperation: string | null = null;
  let backupDetails: Record<string, unknown> | null = null;
  if (seqAnalysis.strategy === "local_wins_non_fast_forward") {
    backupReason = "local_wins_non_fast_forward";
    backupOperation = "sync_local_wins";
    backupDetails = seqAnalysisBackupDetails(body.baseSeq ?? null, seqAnalysis, orderedChanges);
  } else if (seqAnalysis.strategy === "unknown_base") {
    backupReason = "unknown_base";
    backupOperation = "sync_unknown_base";
    backupDetails = seqAnalysisBackupDetails(null, seqAnalysis, orderedChanges);
  } else {
    const explicitKeys = new Set(
      orderedChanges.map((change) => `${change.tableName}:${change.recordId}`),
    );
    const implicitImpactRecords = pushRecords.filter(
      (record) => !explicitKeys.has(`${record.tableName}:${record.recordId}`),
    );
    if (implicitImpactRecords.length > 0) {
      backupReason = "implicit_delete";
      backupOperation = "sync_overlap_delete";
      backupDetails = {
        implicitImpactRecords,
        predictedDeletedRecordIds: predictOverlappingDeletions(db, orderedChanges),
      };
    }
  }

  let backup: { id: string } | null = null;
  const seqBeforeBackup = getLatestSeq() ?? 0;
  if (backupOperation) {
    backup = await createServerBackup(backupOperation, {
      protected: true,
      reason: backupReason,
      details: backupDetails,
    });
    if ((getLatestSeq() ?? 0) !== seqBeforeBackup) {
      writeSyncLog(db, "push_retry_after_backup_race", {
        backupId: backup.id,
        baseSeq: body.baseSeq ?? null,
        seqBeforeBackup,
        latestSeq: getLatestSeq(),
      }, orderedChanges.length);
      const { body: errBody, status } = errorJson(
        ErrorCode.CONFLICT,
        409,
        "Server data changed while the safety backup was being created. Retry sync.",
        { backupId: backup.id },
      );
      return c.json(errBody, status);
    }
  }
  const analyzeBackupMs = performance.now() - analyzeBackupStart;
  const staleServerTimestamps =
    staleGuardAll || staleGuardKeys.size > 0
      ? captureServerTimestamps(db, pushRecords)
      : undefined;
  const results: ApplyChangeResult[] = [];
  const applyAll = db.transaction(() => {
    for (const [index, change] of orderedChanges.entries()) {
      const impactRecords = impactRecordsByChange[index];
      const touchesOverlappingRecord = impactRecords.some((record) =>
        staleGuardKeys.has(`${record.tableName}:${record.recordId}`),
      );
      results.push(
        applyChange(change, {
          db,
          staleGuard: staleGuardAll || touchesOverlappingRecord,
          staleAgainst: impactRecords.filter(
            (record) => record.tableName !== change.tableName || record.recordId !== change.recordId,
          ),
          staleServerTimestamps,
        }),
      );
    }
  });

  const latestSeqBefore = getLatestSeq() ?? 0;
  const applyStart = performance.now();
  try {
    applyAll();
  } catch (err) {
    const message = (err as Error).message;
    console.error("[sync/push] apply failed:", message);
    writeSyncLog(db, "push_failed_after_backup", { backupId: backup?.id ?? null, message }, orderedChanges.length);
    const { body: errBody, status } = errorJson(
      ErrorCode.INTERNAL_ERROR,
      500,
      undefined,
      { backupId: backup?.id ?? null },
    );
    return c.json(errBody, status);
  }
  const applyMs = performance.now() - applyStart;
  const latestSeqAfter = getLatestSeq() ?? 0;
  const appliedCount = latestSeqAfter - latestSeqBefore;

  const outcomes = results.map((result) => outcomeFromApplyResult(result, backup?.id ?? null));
  const response = syncPushResponse(outcomes, backup?.id ?? null, latestSeqAfter, appliedCount);
  const totalMs = performance.now() - t0;
  writeSyncLog(db, "push_received", {
    timings: {
      parseMs: Math.round(parseMs),
      validateMs: Math.round(validateMs),
      analyzeBackupMs: Math.round(analyzeBackupMs),
      applyMs: Math.round(applyMs),
      totalMs: Math.round(totalMs),
    },
    backupId: backup?.id ?? null,
    outcomes: response.outcomes,
    seqAnalysis,
    protected: Boolean(backup),
    overriddenRecordIds: protectedOutcomeIds(outcomes),
    appliedCount,
  }, orderedChanges.length);
  storePushRequestReplay(db, body.requestId, 200, response);
  notifySyncChange(getLatestSeq(), buildBumpPayload(db, latestSeqBefore, latestSeqAfter));
  return c.json(response);
});

function changeFromTombstoneRow(r: TombstoneRow): SyncChange {
  return {
    tableName: r.table_name,
    recordId: r.record_id,
    action: "delete",
    data: null,
    timestamp: r.deleted_at,
  } as SyncChange;
}

interface PullPage {
  changes: SyncChange[];
  nextSinceSeq: number | null;
  hasMore: boolean;
}

// 账本补差：按 sinceSeq 之后每个 record 的最新变更，读取当前业务行或 tombstone。
// 游标按 seq 前进（不按 change 数）：即便某条 change 读不到（null，被过滤），
// nextSinceSeq 仍推进到本批最后一个 seq record 的 id，避免游标卡死。
function readChangesSinceSeq(db: Database, sinceSeq: number | null, limit?: number): PullPage {
  const seqRows = getChangesSinceSeq(sinceSeq, limit);
  const changes: SyncChange[] = [];
  for (const seq of seqRows) {
    if (seq.action === "delete") {
      const tombstone = db
        .prepare("SELECT * FROM sync_tombstones WHERE table_name = ? AND record_id = ?")
        .get(seq.tableName, seq.recordId) as TombstoneRow | undefined;
      if (tombstone) changes.push(changeFromTombstoneRow(tombstone));
      continue;
    }

    const change = getServerDomain(seq.tableName).readRecord(db, seq.recordId);
    if (change) changes.push(change);
  }
  const lastSeqId = seqRows.length > 0 ? seqRows[seqRows.length - 1].id : null;
  const hasMore = limit != null && seqRows.length === limit;
  // 无行时保持 sinceSeq（无可推进）。
  const nextSinceSeq = lastSeqId ?? sinceSeq ?? null;
  return { changes, nextSinceSeq, hasMore };
}

// bump 载荷上限：SSE 是通知通道不是搬运通道，超限退化纯 bump 走 pull（design §C）。
const BUMP_MAX_CHANGES = 50;
const BUMP_MAX_BYTES = 32 * 1024;

// push 专用：构造 (fromSeq, latestSeqAfter] 区间载荷。调用点必须处于 applyAll 之后、
// 同一同步段内（无 await 插队），保证区间恰好等于本次 push 的增量。
function buildBumpPayload(
  db: Database,
  fromSeq: number,
  latestSeqAfter: number,
): { fromSeq: number; changes: SyncChange[] } | undefined {
  if (latestSeqAfter <= fromSeq) return undefined; // 无新 seq（全 conflict 等）
  const page = readChangesSinceSeq(db, fromSeq === 0 ? null : fromSeq, BUMP_MAX_CHANGES + 1);
  if (page.hasMore) return undefined; // 读满 51 条 = 超条数上限
  if (JSON.stringify(page.changes).length > BUMP_MAX_BYTES) return undefined;
  return { fromSeq, changes: page.changes };
}

sync.post("/pull", async (c) => {
  const t0 = performance.now();
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = SyncPullRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, undefined, { issues: parsed.error.issues });
    return c.json(body, status);
  }

  const body = parsed.data;
  const db = getDb();
  // sinceSeq=0 与 null 等价：全量补差。
  const sinceSeq = body.sinceSeq ? body.sinceSeq : null;
  const readStart = performance.now();
  const page = readChangesSinceSeq(db, sinceSeq, body.limit);
  const readMs = performance.now() - readStart;

  const latestSeq = getLatestSeq();
  const response: SyncPullResponse = {
    changes: page.changes,
    serverTime: new Date().toISOString(),
    latestSeq,
    // 不分页（无 limit）时 nextSinceSeq 收敛到 latestSeq，便于客户端一次到位。
    nextSinceSeq: body.limit != null ? page.nextSinceSeq : latestSeq,
    hasMore: page.hasMore,
  };
  const totalMs = performance.now() - t0;

  writeSyncLog(db, "pull_returned", {
    timings: { readMs: Math.round(readMs), totalMs: Math.round(totalMs) },
    sinceSeq: body.sinceSeq,
    limit: body.limit ?? null,
    latestSeq: response.latestSeq,
    nextSinceSeq: response.nextSinceSeq,
    hasMore: response.hasMore,
    categoryIds: page.changes.filter((c) => c.tableName === "categories").map((c) => c.recordId),
    entryIds: page.changes.filter((c) => c.tableName === "time_entries").map((c) => c.recordId),
    settingKeys: page.changes.filter((c) => c.tableName === "settings").map((c) => c.recordId),
    quickNoteIds: page.changes.filter((c) => c.tableName === "quick_notes").map((c) => c.recordId),
  }, page.changes.length);

  return c.json(response);
});

export default sync;
