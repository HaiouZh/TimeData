import { Hono } from "hono";
import crypto from "node:crypto";
import { SyncPushRequestSchema } from "@timedata/shared";
import type {
  Category,
  SyncChange,
  SyncForcePushPrepareRequest,
  SyncForcePushPrepareResponse,
  SyncForcePushRequest,
  SyncForcePushResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushOutcome,
  SyncPushResponse,
  SyncStatusResponse,
  TimeEntry,
} from "@timedata/shared";
import { getDb } from "../db/connection.js";
import { type CategoryRow, type CountRow, type EntryRow, type MaxRow, type TombstoneRow, rowToCategory, rowToEntry } from "../lib/db-rows.js";
import { createServerBackup, markServerBackupProtected } from "../sync/backup.js";
import type { Database } from "better-sqlite3";
import { applyChange, type ApplyChangeResult } from "../sync/resolver.js";
import { orderPushChanges } from "../sync/order.js";
import { validateSyncChanges } from "../sync/validation.js";
import { analyzePushBaseSeq } from "../sync/conflict.js";
import { getChangesSinceSeq, getLatestSeq } from "../sync/seq.js";

const FORCE_PUSH_CONFIRMATION_PHRASE = "OVERWRITE_SERVER" as const;
const FORCE_PUSH_TOKEN_TTL_MS = 5 * 60 * 1000;

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

function assertCategoryShape(category: Category): string | null {
  if (!category || typeof category.id !== "string" || typeof category.name !== "string") return "invalid category shape";
  if (category.parentId !== null && typeof category.parentId !== "string") return `invalid parentId for category ${category.id}`;
  if (typeof category.color !== "string" || typeof category.sortOrder !== "number") return `invalid category fields for ${category.id}`;
  if (typeof category.isArchived !== "boolean" || typeof category.createdAt !== "string" || typeof category.updatedAt !== "string") return `invalid category timestamps for ${category.id}`;
  return null;
}

function assertEntryShape(entry: TimeEntry): string | null {
  if (!entry || typeof entry.id !== "string" || typeof entry.categoryId !== "string") return "invalid entry shape";
  if (typeof entry.startTime !== "string" || typeof entry.endTime !== "string" || entry.endTime <= entry.startTime) return `invalid time range for entry ${entry.id}`;
  if (entry.note !== null && typeof entry.note !== "string") return `invalid note for entry ${entry.id}`;
  if (typeof entry.createdAt !== "string" || typeof entry.updatedAt !== "string") return `invalid entry timestamps for ${entry.id}`;
  return null;
}

function validateForcePushPayload(body: SyncForcePushRequest): string | null {
  if (!Array.isArray(body.categories)) return "categories must be an array";
  if (!Array.isArray(body.timeEntries)) return "timeEntries must be an array";

  const categoryIds = new Set<string>();
  for (const category of body.categories) {
    const error = assertCategoryShape(category);
    if (error) return error;
    if (categoryIds.has(category.id)) return `duplicate category ${category.id}`;
    categoryIds.add(category.id);
  }

  for (const category of body.categories) {
    if (category.parentId === category.id) return `category ${category.id} references itself`;
    if (category.parentId && !categoryIds.has(category.parentId)) return `missing parent category ${category.parentId}`;
    if (category.parentId) {
      const parent = body.categories.find((item) => item.id === category.parentId);
      if (parent && parent.parentId !== null) return `category ${category.id} would create a third level`;
    }
  }

  const entryIds = new Set<string>();
  for (const entry of body.timeEntries) {
    const error = assertEntryShape(entry);
    if (error) return error;
    if (entryIds.has(entry.id)) return `duplicate entry ${entry.id}`;
    if (!categoryIds.has(entry.categoryId)) return `missing category ${entry.categoryId}`;
    entryIds.add(entry.id);
  }

  const sortedEntries = [...body.timeEntries].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < sortedEntries.length; i += 1) {
    if (sortedEntries[i - 1].endTime > sortedEntries[i].startTime) {
      return `overlapping entries ${sortedEntries[i - 1].id} and ${sortedEntries[i].id}`;
    }
  }

  return null;
}

function replaceServerData(db: Database, categories: Category[], timeEntries: TimeEntry[]): void {
  db.prepare("DELETE FROM sync_tombstones").run();
  db.prepare("DELETE FROM sync_seq").run();
  db.prepare("DELETE FROM time_entries").run();
  db.prepare("DELETE FROM categories").run();

  const insertCategory = db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEntry = db.prepare(`
    INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run("categories", category.id, "create");
  }

  for (const entry of timeEntries) {
    insertEntry.run(entry.id, entry.categoryId, entry.startTime, entry.endTime, entry.note, entry.createdAt, entry.updatedAt);
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run("time_entries", entry.id, "create");
  }
}

function readServerStatus(db: Database): SyncStatusResponse {
  const categoryCount = (db.prepare("SELECT COUNT(*) as count FROM categories").get() as CountRow).count;
  const entryCount = (db.prepare("SELECT COUNT(*) as count FROM time_entries").get() as CountRow).count;
  const latestCategory = (db.prepare("SELECT MAX(updated_at) as value FROM categories").get() as MaxRow).value;
  const latestEntry = (db.prepare("SELECT MAX(updated_at) as value FROM time_entries").get() as MaxRow).value;
  const lastUpdatedAt = [latestCategory, latestEntry].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  return {
    categoryCount,
    entryCount,
    lastUpdatedAt,
    latestSeq: getLatestSeq(),
    serverTime: new Date().toISOString(),
  };
}

const sync = new Hono();

function writeSyncLog(db: Database, action: string, detail: unknown, recordCount = 0): void {
  db.prepare("INSERT INTO sync_logs (device, action, detail, record_count) VALUES (?, ?, ?, ?)").run(
    "server",
    action,
    typeof detail === "string" ? detail : JSON.stringify(detail),
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

function protectedBackupDetails(outcomes: SyncPushOutcome[]): Record<string, unknown> | null {
  const overridden = outcomes
    .filter((outcome) => outcome.overriddenRecordIds?.length)
    .map((outcome) => ({
      localRecordId: outcome.recordId,
      tableName: outcome.tableName,
      overriddenRecordIds: outcome.overriddenRecordIds ?? [],
    }));

  return overridden.length ? { overridden } : null;
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
    reasonCode: result.status === "applied" ? "applied" : "server_version_newer_or_same",
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

sync.post("/force-push/prepare", async (c) => {
  const body = await c.req.json<SyncForcePushPrepareRequest>();
  const db = getDb();
  const { token, expiresAt } = createForcePushToken({
    categoryCount: Number(body.categoryCount || 0),
    entryCount: Number(body.entryCount || 0),
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
  const body = await c.req.json<SyncForcePushRequest>();
  const db = getDb();
  if (body.confirmationPhrase !== FORCE_PUSH_CONFIRMATION_PHRASE) {
    writeSyncLog(db, "force_push_rejected", { reason: "invalid_phrase" });
    return c.json({ error: "Invalid force-push confirmation phrase." }, 400);
  }

  const tokenRecord = consumeForcePushToken(body.confirmToken || "", Date.now());
  if (tokenRecord.status === "expired") {
    writeSyncLog(db, "force_push_expired", { reason: "expired_token" });
    return c.json({ error: "Invalid or expired force-push confirmation token." }, 403);
  }
  if (tokenRecord.status === "missing") {
    writeSyncLog(db, "force_push_rejected", { reason: "missing_token" });
    return c.json({ error: "Invalid or expired force-push confirmation token." }, 403);
  }

  const validationError = validateForcePushPayload(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const backup = await createServerBackup("sync_force_push");
  const replaceAll = db.transaction(() => {
    replaceServerData(db, body.categories, body.timeEntries);
  });

  try {
    replaceAll();
  } catch (err) {
    const message = (err as Error).message;
    writeSyncLog(db, "force_push_failed_after_backup", { backupId: backup.id, message }, body.categories.length + body.timeEntries.length);
    return c.json({ error: message, backupId: backup.id }, 500);
  }

  const response: SyncForcePushResponse = {
    importedCategories: body.categories.length,
    importedTimeEntries: body.timeEntries.length,
    backupId: backup.id,
    serverTime: new Date().toISOString(),
    latestSeq: getLatestSeq(),
  };

  writeSyncLog(db, "force_push_applied", {
    backupId: backup.id,
    localSummary: tokenRecord.record.localSummary,
    importedCategories: response.importedCategories,
    importedTimeEntries: response.importedTimeEntries,
  }, body.categories.length + body.timeEntries.length);

  return c.json(response);
});

sync.post("/push", async (c) => {
  const rawBody: unknown = await c.req.json();
  const parsed = SyncPushRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
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
  const backupOperation =
    seqAnalysis.strategy === "local_wins_non_fast_forward"
      ? "sync_local_wins"
      : seqAnalysis.strategy === "unknown_base"
        ? "sync_unknown_base"
        : "sync_push";
  const backup = await createServerBackup(backupOperation);
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
    writeSyncLog(db, "push_failed_after_backup", { backupId: backup.id, message }, orderedChanges.length);
    return c.json({ error: message, backupId: backup.id }, 500);
  }

  const outcomes = results.map((result) => outcomeFromApplyResult(result, backup.id));
  const protectedDetails = protectedBackupDetails(outcomes);
  if (seqAnalysis.strategy === "local_wins_non_fast_forward") {
    markServerBackupProtected(backup.id, {
      protected: true,
      reason: "local_wins_non_fast_forward",
      details: seqAnalysisBackupDetails(body.baseSeq ?? null, seqAnalysis, orderedChanges),
    });
  } else if (seqAnalysis.strategy === "unknown_base") {
    markServerBackupProtected(backup.id, {
      protected: true,
      reason: "unknown_base",
      details: seqAnalysisBackupDetails(null, seqAnalysis, orderedChanges),
    });
  } else if (protectedDetails) {
    markServerBackupProtected(backup.id, {
      protected: true,
      reason: "local_override_overlap",
      details: protectedDetails,
    });
  }

  const response = syncPushResponse(outcomes, backup.id);
  writeSyncLog(db, "push_received", {
    backupId: backup.id,
    outcomes: response.outcomes,
    seqAnalysis,
    protected: seqAnalysis.strategy === "local_wins_non_fast_forward" || seqAnalysis.strategy === "unknown_base" || Boolean(protectedDetails),
    overriddenRecordIds: protectedOutcomeIds(outcomes),
  }, orderedChanges.length);
  return c.json(response);
});

function changeFromCategoryRow(r: CategoryRow): SyncChange {
  return {
    tableName: "categories",
    recordId: r.id,
    action: "update",
    data: rowToCategory(r),
    timestamp: r.updated_at,
  };
}

function changeFromEntryRow(r: EntryRow): SyncChange {
  return {
    tableName: "time_entries",
    recordId: r.id,
    action: "update",
    data: rowToEntry(r),
    timestamp: r.updated_at,
  };
}

function changeFromTombstoneRow(r: TombstoneRow): SyncChange {
  return {
    tableName: r.table_name,
    recordId: r.record_id,
    action: "delete",
    data: null,
    timestamp: r.deleted_at,
  };
}

function sortChanges(changes: SyncChange[]): void {
  changes.sort((a, b) => {
    const timestampOrder = a.timestamp.localeCompare(b.timestamp);
    if (timestampOrder !== 0) return timestampOrder;
    const tableOrder = a.tableName.localeCompare(b.tableName);
    if (tableOrder !== 0) return tableOrder;
    return a.recordId.localeCompare(b.recordId);
  });
}

function readChangesSinceTimestamp(db: Database, since: string): SyncChange[] {
  const categories = db.prepare("SELECT * FROM categories WHERE updated_at >= ?").all(since) as CategoryRow[];
  const entries = db.prepare("SELECT * FROM time_entries WHERE updated_at >= ?").all(since) as EntryRow[];
  const tombstones = db.prepare("SELECT * FROM sync_tombstones WHERE deleted_at >= ?").all(since) as TombstoneRow[];
  const changes = [
    ...categories.map(changeFromCategoryRow),
    ...entries.map(changeFromEntryRow),
    ...tombstones.map(changeFromTombstoneRow),
  ];
  sortChanges(changes);
  return changes;
}

function readChangesSinceSeq(db: Database, sinceSeq: number | null): SyncChange[] {
  const changes: SyncChange[] = [];
  for (const seq of getChangesSinceSeq(sinceSeq)) {
    if (seq.action === "delete") {
      const tombstone = db.prepare("SELECT * FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(seq.tableName, seq.recordId) as TombstoneRow | undefined;
      if (tombstone) changes.push(changeFromTombstoneRow(tombstone));
      continue;
    }

    if (seq.tableName === "categories") {
      const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(seq.recordId) as CategoryRow | undefined;
      if (row) changes.push(changeFromCategoryRow(row));
      continue;
    }

    const row = db.prepare("SELECT * FROM time_entries WHERE id = ?").get(seq.recordId) as EntryRow | undefined;
    if (row) changes.push(changeFromEntryRow(row));
  }
  return changes;
}

sync.post("/pull", async (c) => {
  const body = await c.req.json<SyncPullRequest>();
  const db = getDb();
  const since = body.since || body.lastSyncedAt || "1970-01-01T00:00:00.000Z";
  const sinceSeq = typeof body.sinceSeq === "number" ? body.sinceSeq : null;
  const changes = body.sinceSeq != null ? readChangesSinceSeq(db, sinceSeq) : readChangesSinceTimestamp(db, since);

  const response: SyncPullResponse = {
    changes,
    serverTime: new Date().toISOString(),
    latestSeq: getLatestSeq(),
  };

  writeSyncLog(db, "pull_returned", {
    since,
    sinceSeq: body.sinceSeq ?? null,
    latestSeq: response.latestSeq,
    categoryIds: changes.filter((c) => c.tableName === "categories").map((c) => c.recordId),
    entryIds: changes.filter((c) => c.tableName === "time_entries").map((c) => c.recordId),
  }, changes.length);

  return c.json(response);
});

export default sync;
