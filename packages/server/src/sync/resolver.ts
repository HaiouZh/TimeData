import type { SyncChange } from "@timedata/shared";
import type { Database } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { type ApplyChangeResult, type ServerDomainHooks, applyResult, getServerDomain } from "./domains.js";
import { recordSeqWithDb } from "./seq.js";

export type { ApplyChangeResult } from "./domains.js";

export interface ApplyChangeOptions {
  /** 仅对冲突记录启用：来包时间戳 <= 服务器现存行或 tombstone 时间戳时拒收。 */
  staleGuard?: boolean;
  /** 隐式受影响记录（分类级联、时间重叠删除）也参与 staleGuard。 */
  staleAgainst?: Array<{ tableName: SyncChange["tableName"]; recordId: string }>;
  /** 本批 apply 开始前冻结的服务器时间戳，避免同批前序变更产生的 tombstone 误伤后序变更。 */
  staleServerTimestamps?: ReadonlyMap<string, string | null>;
  /** 复用调用方事务中的连接，避免写业务表和记账分叉。 */
  db?: Database;
}

function recordKey(record: { tableName: SyncChange["tableName"]; recordId: string }): string {
  return `${record.tableName}:${record.recordId}`;
}

function serverTimestampFor(
  db: Database,
  record: { tableName: SyncChange["tableName"]; recordId: string },
): string | null {
  const existing = getServerDomain(record.tableName).readRecord(db, record.recordId);
  if (existing) return existing.timestamp;
  const tombstone = db
    .prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?")
    .get(record.tableName, record.recordId) as { deleted_at: string } | undefined;
  return tombstone?.deleted_at ?? null;
}

export function captureServerTimestamps(
  db: Database,
  records: Array<{ tableName: SyncChange["tableName"]; recordId: string }>,
): ReadonlyMap<string, string | null> {
  return new Map(records.map((record) => [recordKey(record), serverTimestampFor(db, record)]));
}

function rejectIfStale(
  db: Database,
  change: SyncChange,
  staleAgainst: Array<{ tableName: SyncChange["tableName"]; recordId: string }> = [],
  staleServerTimestamps?: ReadonlyMap<string, string | null>,
): ApplyChangeResult | null {
  const records = [
    { tableName: change.tableName, recordId: change.recordId },
    ...staleAgainst,
  ];
  let serverTs: string | null = null;
  for (const record of records) {
    const key = recordKey(record);
    const candidate = staleServerTimestamps?.has(key)
      ? staleServerTimestamps.get(key) ?? null
      : serverTimestampFor(db, record);
    if (candidate != null && (serverTs == null || candidate > serverTs)) serverTs = candidate;
  }
  if (serverTs == null || change.timestamp > serverTs) return null;
  return applyResult(
    change,
    "skipped",
    `stale change rejected: incoming ${change.timestamp} <= server ${serverTs}`,
    serverTs,
    undefined,
    "stale_change_rejected",
  );
}

export function applyChange(change: SyncChange, options: ApplyChangeOptions = {}): ApplyChangeResult {
  const db = options.db ?? getDb();
  if (options.staleGuard) {
    const stale = rejectIfStale(db, change, options.staleAgainst, options.staleServerTimestamps);
    if (stale) return stale;
  }
  const domain = getServerDomain(change.tableName);
  if (domain.guard) {
    const rejected = domain.guard(db, change);
    if (rejected) return rejected;
  }
  const serverNow = new Date().toISOString();
  const lww = domain.lww;
  if (!domain.apply && !lww) throw new Error(`Sync domain ${change.tableName} has neither apply hook nor lww mapping`);
  const changeResult = domain.apply
    ? domain.apply(db, change, serverNow)
    : applyLwwChange(db, change, lww as NonNullable<ServerDomainHooks["lww"]>, serverNow);

  // 只有成功写入才推进 seq cursor，skipped 的变更不占 seq 位置（供上游判断应用顺序）。
  if (changeResult.status === "applied" && !changeResult.primarySeqRecorded) {
    recordSeqWithDb(db, change.tableName, change.recordId, change.action);
  }

  return changeResult;
}

// 通用 LWW 写入：delete = 真删除 + tombstone；upsert = 删 tombstone + INSERT ... ON CONFLICT DO UPDATE。
// updated_at / deleted_at 由服务器在记账时分配；created_at 与主键列只在插入时写入。
function applyLwwChange(
  db: Database,
  change: SyncChange,
  lww: NonNullable<ServerDomainHooks["lww"]>,
  serverNow: string,
): ApplyChangeResult {
  const table = change.tableName;

  if (change.action === "delete") {
    lww.archiveDelete?.(db, change, serverNow);
    db.prepare(`DELETE FROM ${table} WHERE ${lww.idColumn} = ?`).run(change.recordId);
    db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `).run(table, change.recordId, serverNow);
    return applyResult(change, "applied", `deleted ${table} record`);
  }

  db.prepare("DELETE FROM sync_tombstones WHERE table_name = ? AND record_id = ?").run(table, change.recordId);

  const existing = db.prepare(`SELECT updated_at FROM ${table} WHERE ${lww.idColumn} = ?`).get(change.recordId) as
    | { updated_at: string }
    | undefined;

  const row: Record<string, string | number | null> = { ...lww.toRow(change.data), updated_at: serverNow };
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const hasOp = (change as { op?: unknown }).op != null;
  const guarded = !hasOp && lww.guardedColumns ? new Set(lww.guardedColumns) : null;
  const updatable = columns.filter(
    (column) => column !== lww.idColumn && column !== "created_at" && !(guarded?.has(column) ?? false),
  );
  const setClause = updatable.map((column) => `${column} = excluded.${column}`).join(", ");

  db.prepare(`
    INSERT INTO ${table} (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${lww.idColumn}) DO UPDATE SET ${setClause}
  `).run(...columns.map((column) => row[column]));

  return applyResult(
    change,
    "applied",
    existing ? `updated ${table} record` : `inserted ${table} record`,
    existing?.updated_at,
  );
}
