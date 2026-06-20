import type Database from "better-sqlite3";
import { computeAndPersistCommitHash } from "../sync/state.js";
import { insertDefaultCategories } from "./reset.js";

export interface UtcResetResult {
  ran: boolean;
  resetAt?: string;
}

export function runUtcResetIfNeeded(db: Database.Database): UtcResetResult {
  const existing = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get("utc_reset_v1");
  if (existing) return { ran: false };

  const resetAt = new Date().toISOString();

  db.transaction(() => {
    db.prepare("DELETE FROM track_steps").run();
    db.prepare("DELETE FROM tracks").run();
    db.prepare("DELETE FROM quick_notes").run();
    db.prepare("DELETE FROM time_entries").run();
    db.prepare("DELETE FROM settings").run();
    db.prepare("DELETE FROM sync_logs").run();
    db.prepare("DELETE FROM sync_tombstones").run();
    db.prepare("DELETE FROM sync_seq").run();
    db.prepare("DELETE FROM categories WHERE parent_id IS NOT NULL").run();
    db.prepare("DELETE FROM categories WHERE parent_id IS NULL").run();
    insertDefaultCategories(db, resetAt);
    computeAndPersistCommitHash(db);
    db.prepare("INSERT OR REPLACE INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)").run(
      "utc_reset_v1",
      resetAt,
      resetAt,
    );
  })();

  return { ran: true, resetAt };
}
