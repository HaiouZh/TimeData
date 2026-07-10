import type Database from "better-sqlite3";
import { resetDatabaseConnectionToDefaultsInTransaction } from "./reset.js";

export interface UtcResetResult {
  ran: boolean;
  resetAt?: string;
}

export function runUtcResetIfNeeded(db: Database.Database): UtcResetResult {
  const existing = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get("utc_reset_v1");
  if (existing) return { ran: false };

  const resetAt = new Date().toISOString();

  db.transaction(() => {
    resetDatabaseConnectionToDefaultsInTransaction(db, resetAt);
    db.prepare("INSERT OR REPLACE INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)").run(
      "utc_reset_v1",
      resetAt,
      resetAt,
    );
  })();

  return { ran: true, resetAt };
}
