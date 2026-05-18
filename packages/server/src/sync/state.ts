import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../db/connection.js";

const DIRTY_VALUE = "1";
const CLEAN_VALUE = "0";

interface StateRow {
  value: string;
}

export interface SyncCommitHashState {
  hash: string;
  latestSeq: number | null;
}

function upsertState(db: Database.Database, key: string, value: string, updatedAt: string): void {
  db.prepare(`
    INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, updatedAt);
}

function readLatestSeq(db: Database.Database): number | null {
  const row = db.prepare("SELECT MAX(id) as max_id FROM sync_seq").get() as { max_id: number | null } | undefined;
  return row?.max_id ?? null;
}

export function markCommitHashDirty(db: Database.Database = getDb()): void {
  upsertState(db, "dirty", DIRTY_VALUE, new Date().toISOString());
}

export function computeAndPersistCommitHash(db: Database.Database = getDb()): SyncCommitHashState {
  const latestSeq = readLatestSeq(db);
  const entryCount = (db.prepare("SELECT COUNT(*) AS count FROM time_entries").get() as { count: number }).count;
  const categoryCount = (db.prepare("SELECT COUNT(*) AS count FROM categories").get() as { count: number }).count;
  const lastUpdatedAt =
    (
      db
        .prepare(`
    SELECT MAX(updated_at) AS value FROM (
      SELECT updated_at FROM time_entries
      UNION ALL
      SELECT updated_at FROM categories
    )
  `)
        .get() as { value: string | null }
    ).value ?? "";
  const hash = createHash("sha256")
    .update(`${latestSeq ?? ""}|${entryCount}|${categoryCount}|${lastUpdatedAt}`)
    .digest("hex");
  const now = new Date().toISOString();

  upsertState(db, "commit_hash", hash, now);
  upsertState(db, "latest_seq", latestSeq == null ? "" : String(latestSeq), now);
  upsertState(db, "row_count_entries", String(entryCount), now);
  upsertState(db, "row_count_categories", String(categoryCount), now);
  upsertState(db, "last_updated_at", lastUpdatedAt, now);
  upsertState(db, "dirty", CLEAN_VALUE, now);

  return { hash, latestSeq };
}

export function getCommitHash(db: Database.Database = getDb()): SyncCommitHashState {
  const hashRow = db.prepare("SELECT value FROM sync_state WHERE key = 'commit_hash'").get() as StateRow | undefined;
  const latestSeqRow = db.prepare("SELECT value FROM sync_state WHERE key = 'latest_seq'").get() as
    | StateRow
    | undefined;
  const dirtyRow = db.prepare("SELECT value FROM sync_state WHERE key = 'dirty'").get() as StateRow | undefined;
  if (!hashRow || !latestSeqRow || dirtyRow?.value === DIRTY_VALUE) return computeAndPersistCommitHash(db);

  return {
    hash: hashRow.value,
    latestSeq: latestSeqRow.value === "" ? null : Number(latestSeqRow.value),
  };
}
