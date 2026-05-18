import { z } from "zod";
import { Hono } from "hono";
import { getDb } from "../db/connection.js";

const syncLog = new Hono();

const SyncLogEntrySchema = z.object({
  device: z.string().max(100).optional(),
  action: z.string().min(1).max(100),
  detail: z.string().max(1000).optional(),
  record_count: z.number().int().nonnegative().optional().default(0),
});
const SyncLogPostSchema = z.union([SyncLogEntrySchema, z.array(SyncLogEntrySchema).max(100)]);

syncLog.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SyncLogPostSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "INVALID_BODY", detail: parsed.error.message }, 400);
  }

  const db = getDb();
  const entries = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  const insert = db.prepare(
    "INSERT INTO sync_logs (device, action, detail, record_count) VALUES (?, ?, ?, ?)"
  );

  const insertAll = db.transaction(() => {
    for (const entry of entries) {
      insert.run(
        entry.device || null,
        entry.action,
        entry.detail || null,
        entry.record_count,
      );
    }
  });

  insertAll();
  return c.json({ inserted: entries.length }, 201);
});

syncLog.get("/", (c) => {
  const db = getDb();
  const rawLimit = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 50;
  const rows = db.prepare(
    "SELECT * FROM sync_logs ORDER BY id DESC LIMIT ?"
  ).all(limit);
  return c.json(rows);
});

syncLog.delete("/", (c) => {
  if (c.req.header("X-Confirm") !== "true") {
    return c.json({ error: "CONFIRMATION_REQUIRED", hint: "send header X-Confirm: true" }, 412);
  }

  const db = getDb();
  db.prepare("DELETE FROM sync_logs").run();
  return c.json({ cleared: true });
});

export default syncLog;
