import { Hono } from "hono";
import { getDb } from "../db/connection.js";

const syncLog = new Hono();

interface SyncLogEntry {
  device?: string;
  action: string;
  detail?: string;
  record_count?: number;
}

syncLog.post("/", async (c) => {
  const body = await c.req.json<SyncLogEntry | SyncLogEntry[]>();
  const db = getDb();
  const entries = Array.isArray(body) ? body : [body];

  const insert = db.prepare(
    "INSERT INTO sync_logs (device, action, detail, record_count) VALUES (?, ?, ?, ?)"
  );

  const insertAll = db.transaction(() => {
    for (const entry of entries) {
      insert.run(
        entry.device || null,
        entry.action,
        entry.detail || null,
        entry.record_count || 0,
      );
    }
  });

  insertAll();
  return c.json({ inserted: entries.length });
});

syncLog.get("/", (c) => {
  const db = getDb();
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const rows = db.prepare(
    "SELECT * FROM sync_logs ORDER BY id DESC LIMIT ?"
  ).all(limit);
  return c.json(rows);
});

syncLog.delete("/", (c) => {
  const db = getDb();
  db.prepare("DELETE FROM sync_logs").run();
  return c.json({ cleared: true });
});

export default syncLog;
