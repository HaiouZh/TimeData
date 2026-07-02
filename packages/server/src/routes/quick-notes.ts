import { randomUUID } from "node:crypto";
import { UtcIsoStringSchema, type SyncChange } from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { rowToQuickNote, type QuickNoteRow } from "../lib/db-rows.js";
import { errorJson, ErrorCode } from "../lib/errors.js";
import { listQuickNotesForCli, type QuickNotesQuery } from "../lib/quick-note-service.js";
import { notifySyncChange } from "../sync/notifier.js";
import { applyChange } from "../sync/resolver.js";
import { getLatestSeq } from "../sync/seq.js";

const quickNotes = new Hono();

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const querySchema = z
  .object({
    date: DateSchema.optional(),
    from: DateSchema.optional(),
    to: DateSchema.optional(),
    recent: z.enum(["1", "true"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    format: z.string().optional(),
  })
  .strict();
const RequestIdSchema = z.string().trim().min(1).max(128);
const createSchema = z
  .object({
    text: z.string().trim().min(1).max(5000),
    sourceLabel: z.string().trim().min(1).max(64).optional(),
    occurredAt: UtcIsoStringSchema.optional(),
    requestId: RequestIdSchema.optional(),
  })
  .strict();

function invalidQuery(message: string) {
  return { ok: false, error: { code: "INVALID_REQUEST", message } };
}

quickNotes.get("/", (c) => {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Invalid query", details: parsed.error.issues } }, 400);
  }

  const { date, from, to, recent, limit } = parsed.data;
  let query: QuickNotesQuery;
  if (recent) {
    if (date || from || to) return c.json(invalidQuery("--recent cannot be combined with --date, --from, or --to"), 400);
    query = { mode: "recent", limit };
  } else if (from || to) {
    if (!from || !to) return c.json(invalidQuery("--from and --to must be provided together"), 400);
    if (date) return c.json(invalidQuery("--date cannot be combined with --from or --to"), 400);
    query = { mode: "range", from, to };
  } else if (date) {
    query = { mode: "date", date };
  } else {
    return c.json(invalidQuery("date, from/to, or recent is required"), 400);
  }

  const result = listQuickNotesForCli(getDb(), query);
  return c.json(result, result.ok ? 200 : 400);
});

quickNotes.post("/", async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, "Invalid quick note", { issues: parsed.error.issues });
    return c.json(body, status);
  }

  const db = getDb();
  const id = parsed.data.requestId ?? randomUUID();

  // requestId 幂等：同一投递重试命中已有记录时返回原记录，不重复落库（对齐 agent-tracks 端点）。
  const existingRow = db.prepare("SELECT * FROM quick_notes WHERE id = ?").get(id) as QuickNoteRow | undefined;
  if (existingRow) {
    return c.json({ ok: true, quickNote: rowToQuickNote(existingRow), idempotent: true });
  }

  const now = new Date().toISOString();
  const quickNote = {
    id,
    text: parsed.data.text,
    occurredAt: parsed.data.occurredAt ?? now,
    createdAt: now,
    updatedAt: now,
    source: "agent" as const,
    ...(parsed.data.sourceLabel ? { sourceLabel: parsed.data.sourceLabel } : {}),
  };
  const change: SyncChange = {
    tableName: "quick_notes",
    action: "create",
    recordId: quickNote.id,
    timestamp: now,
    data: quickNote,
  };

  db.transaction(() => {
    applyChange(change);
  })();
  notifySyncChange(getLatestSeq());

  return c.json({ ok: true, quickNote, idempotent: false }, 201);
});

export default quickNotes;
