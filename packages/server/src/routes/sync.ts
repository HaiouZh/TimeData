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
import { getServerDomain, predictOverlappingDeletions } from "../sync/domains.js";
import { applyChange, type ApplyChangeResult } from "../sync/resolver.js";
import { orderPushChanges } from "../sync/order.js";
import { validateSyncChanges } from "../sync/validation.js";
import { analyzePushBaseSeq } from "../sync/conflict.js";
import { validateForcePushBusinessRules } from "../sync/forcePushValidation.js";
import { getChangesSinceSeq, getLatestSeq, recordSeqWithDb } from "../sync/seq.js";
import { computeAndPersistCommitHash, getCommitHash } from "../sync/state.js";
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

function replaceServerData(
  db: Database,
  categories: Category[],
  timeEntries: TimeEntry[],
  quickNotes: QuickNote[],
  tasks: Task[],
  settings?: Setting[],
): void {
  db.prepare("DELETE FROM sync_tombstones").run();
  db.prepare("DELETE FROM sync_seq").run();
  db.prepare("DELETE FROM goal_layout_pins").run();
  db.prepare("DELETE FROM tasks").run();
  db.prepare("DELETE FROM quick_notes").run();
  db.prepare("DELETE FROM time_entries").run();
  db.prepare("DELETE FROM categories").run();
  if (settings !== undefined) {
    db.prepare("DELETE FROM settings").run();
  }

  const insertCategory = db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEntry = db.prepare(`
    INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSetting = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
  const insertQuickNote = db.prepare(`
    INSERT INTO quick_notes (id, text, occurred_at, created_at, updated_at, source, source_label, pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, done, recurrence, last_done_at, start_at, sort_order, scheduled_at, parent_id, completed_count, weight, rule_id, skipped, completed_at, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const orderedCategories = [...categories].sort((a, b) => {
    if (a.parentId === null && b.parentId !== null) return -1;
    if (a.parentId !== null && b.parentId === null) return 1;
    return a.sortOrder - b.sortOrder;
  });

  for (const category of orderedCategories) {
    insertCategory.run(
      category.id,
      category.name,
      category.parentId,
      category.color,
      category.icon,
      category.sortOrder,
      category.isArchived ? 1 : 0,
      category.createdAt,
      category.updatedAt,
    );
    recordSeqWithDb(db, "categories", category.id, "create");
  }

  for (const entry of timeEntries) {
    insertEntry.run(entry.id, entry.categoryId, entry.startTime, entry.endTime, entry.note, entry.createdAt, entry.updatedAt);
    recordSeqWithDb(db, "time_entries", entry.id, "create");
  }

  for (const note of quickNotes) {
    insertQuickNote.run(
      note.id,
      note.text,
      note.occurredAt,
      note.createdAt,
      note.updatedAt,
      note.source ?? null,
      note.sourceLabel ?? null,
      note.pinned ? 1 : 0,
    );
    recordSeqWithDb(db, "quick_notes", note.id, "create");
  }

  for (const task of tasks) {
    insertTask.run(
      task.id,
      task.title,
      task.done ? 1 : 0,
      task.recurrence ? JSON.stringify(task.recurrence) : null,
      task.lastDoneAt,
      task.startAt,
      task.sortOrder,
      task.scheduledAt ?? null,
      task.parentId ?? null,
      task.completedCount ?? 0,
      task.weight ?? 0,
      task.ruleId ?? null,
      task.skipped ? 1 : 0,
      task.completedAt ?? null,
      JSON.stringify(task.tags ?? []),
      task.createdAt,
      task.updatedAt,
    );
    recordSeqWithDb(db, "tasks", task.id, "create");
  }

  if (settings !== undefined) {
    for (const setting of settings) {
      insertSetting.run(setting.key, setting.value, setting.updatedAt);
      recordSeqWithDb(db, "settings", setting.key, "create");
    }
  }

  computeAndPersistCommitHash(db);
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

function syncPushResponse(outcomes: SyncPushOutcome[], backupId: string | null): SyncPushResponse {
  return {
    outcomes,
    accepted: outcomes.filter((r) => r.status === "accepted").length,
    rejected: outcomes.filter((r) => r.status === "rejected").length,
    conflicts: outcomes.filter((r) => r.status === "conflict").length,
    backupId,
    serverTime: new Date().toISOString(),
  };
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
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ latestSeq: getLatestSeq() }) });

    const listener: SyncStreamListener = (latestSeq) => {
      void stream.writeSSE({ event: "bump", data: JSON.stringify({ latestSeq }) }).catch(() => undefined);
    };
    addSyncStreamListener(listener);
    stream.onAbort(() => removeSyncStreamListener(listener));

    try {
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
  const replaceAll = db.transaction(() => {
    replaceServerData(db, body.categories, body.timeEntries, body.quickNotes, body.tasks, body.settings);
  });

  try {
    replaceAll();
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
  const rawBody: unknown = await c.req.json();
  const parsed = SyncPushRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, undefined, { issues: parsed.error.issues });
    return c.json(body, status);
  }

  const body = parsed.data;
  const db = getDb();
  const orderedChanges = orderPushChanges(body.changes);
  const validation = validateSyncChanges(db, orderedChanges);

  if (!validation.valid) {
    const response = syncPushResponse(validation.outcomes, null);
    writeSyncLog(db, "push_rejected", response.outcomes, response.outcomes.length);
    return c.json(response, 409);
  }

  const pushRecords = orderedChanges.map((change) => ({ tableName: change.tableName, recordId: change.recordId }));
  const seqAnalysis = analyzePushBaseSeq(body.baseSeq ?? null, pushRecords);
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
    const predictedDeletedRecordIds = predictOverlappingDeletions(db, orderedChanges);
    if (predictedDeletedRecordIds.length > 0) {
      backupReason = "overlap_delete";
      backupOperation = "sync_overlap_delete";
      backupDetails = { predictedDeletedRecordIds };
    }
  }

  let backup: { id: string } | null = null;
  if (backupOperation) {
    backup = await createServerBackup(backupOperation, {
      protected: true,
      reason: backupReason,
      details: backupDetails,
    });
  }
  const results: ApplyChangeResult[] = [];
  const applyAll = db.transaction(() => {
    for (const change of orderedChanges) {
      results.push(applyChange(change));
    }
  });

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

  const outcomes = results.map((result) => outcomeFromApplyResult(result, backup?.id ?? null));
  const response = syncPushResponse(outcomes, backup?.id ?? null);
  writeSyncLog(db, "push_received", {
    backupId: backup?.id ?? null,
    outcomes: response.outcomes,
    seqAnalysis,
    protected: Boolean(backup),
    overriddenRecordIds: protectedOutcomeIds(outcomes),
  }, orderedChanges.length);
  notifySyncChange(getLatestSeq());
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

// 账本补差：按 sinceSeq 之后每个 record 的最新变更，读取当前业务行或 tombstone。
function readChangesSinceSeq(db: Database, sinceSeq: number | null): SyncChange[] {
  const changes: SyncChange[] = [];
  for (const seq of getChangesSinceSeq(sinceSeq)) {
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
  return changes;
}

sync.post("/pull", async (c) => {
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
  const changes = readChangesSinceSeq(db, sinceSeq);

  const response: SyncPullResponse = {
    changes,
    serverTime: new Date().toISOString(),
    latestSeq: getLatestSeq(),
  };

  writeSyncLog(db, "pull_returned", {
    sinceSeq: body.sinceSeq,
    latestSeq: response.latestSeq,
    categoryIds: changes.filter((c) => c.tableName === "categories").map((c) => c.recordId),
    entryIds: changes.filter((c) => c.tableName === "time_entries").map((c) => c.recordId),
    settingKeys: changes.filter((c) => c.tableName === "settings").map((c) => c.recordId),
    quickNoteIds: changes.filter((c) => c.tableName === "quick_notes").map((c) => c.recordId),
  }, changes.length);

  return c.json(response);
});

export default sync;
