import { getDb } from "../db/connection.js";

export function getServerConfig(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM server_config WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setServerConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO server_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, new Date().toISOString());
}
