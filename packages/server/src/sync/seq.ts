import type { Database } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { markCommitHashDirty } from "./state.js";

// 账本不关心域：tableName 只是账本上的一列字符串，校验与路由由登记簿负责。
export interface SeqRecord {
  id: number;
  tableName: string;
  recordId: string;
  action: "create" | "update" | "delete";
}

export function recordSeqWithDb(
  db: Database,
  tableName: SeqRecord["tableName"],
  recordId: string,
  action: SeqRecord["action"],
): number {
  const result = db
    .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
    .run(tableName, recordId, action);
  markCommitHashDirty(db);
  return Number(result.lastInsertRowid);
}

export function recordSeq(tableName: SeqRecord["tableName"], recordId: string, action: SeqRecord["action"]): number {
  return recordSeqWithDb(getDb(), tableName, recordId, action);
}

export function getLatestSeq(): number | null {
  const db = getDb();
  const row = db.prepare("SELECT MAX(id) as max_id FROM sync_seq").get() as { max_id: number | null } | undefined;
  return row?.max_id ?? null;
}

export function getChangesSinceSeq(sinceSeq: number | null): SeqRecord[] {
  const db = getDb();
  const condition = sinceSeq != null ? "WHERE id > ?" : "";
  const params = sinceSeq != null ? [sinceSeq] : [];
  const rows = db
    .prepare(`
    SELECT s.id, s.table_name, s.record_id, s.action
    FROM sync_seq s
    INNER JOIN (
      SELECT table_name, record_id, MAX(id) as max_id
      FROM sync_seq
      ${condition}
      GROUP BY table_name, record_id
    ) latest ON latest.max_id = s.id
    ORDER BY s.id ASC
  `)
    .all(...params) as Array<{
    id: number;
    table_name: SeqRecord["tableName"];
    record_id: string;
    action: SeqRecord["action"];
  }>;

  return rows.map((row) => ({
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
  }));
}
