import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { type EntryRow, rowToEntry } from "../lib/db-rows.js";
import { createEntryFromCliInput, listEntriesForCliDate, nextDate } from "../lib/entry-service.js";
import { localDateTimeToUtc } from "@timedata/shared";
import { errorJson, ErrorCode } from "../lib/errors.js";
import { notifySyncChange } from "../sync/notifier.js";
import { getLatestSeq } from "../sync/seq.js";

const entries = new Hono();

entries.get("/", (c) => {
  const date = c.req.query("date");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const format = c.req.query("format");
  const version = c.req.query("v");

  const db = getDb();

  if (format === "cli") {
    if (!date) {
      return c.json({ ok: false, error: { code: "INVALID_DATE", message: "date is required for CLI format" } }, 400);
    }
    const result = listEntriesForCliDate(db, date);
    return c.json(result, result.ok ? 200 : 400);
  }

  let rows: EntryRow[];

  if (date) {
    const dayStartUtc = localDateTimeToUtc(`${date}T00:00:00`);
    const dayEndUtc   = localDateTimeToUtc(`${nextDate(date)}T00:00:00`);
    rows = db.prepare(
      "SELECT * FROM time_entries WHERE start_time >= ? AND start_time < ? ORDER BY start_time"
    ).all(dayStartUtc, dayEndUtc) as EntryRow[];
  } else if (from && to) {
    rows = db.prepare(
      "SELECT * FROM time_entries WHERE start_time >= ? AND end_time <= ? ORDER BY start_time"
    ).all(from, to) as EntryRow[];
  } else {
    rows = db.prepare(
      "SELECT * FROM time_entries ORDER BY start_time DESC LIMIT 100"
    ).all() as EntryRow[];
  }

  const mapped = rows.map(rowToEntry);

  // v=2 introduces a forward-compatible envelope so future paging metadata can be
  // added without another breaking change. Default response (no `v`) stays as a
  // bare array for backwards compatibility with existing client/CLI callers.
  if (version === "2") {
    return c.json({
      entries: mapped,
      total: mapped.length,
      hasMore: false,
    });
  }

  return c.json(mapped);
});

const TimeInputSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm");

const EntriesPostBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  start: TimeInputSchema,
  end: TimeInputSchema,
  category: z.string().min(1),
  note: z.string().nullable().optional(),
}).strict();

entries.post("/", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    const { body, status } = errorJson(ErrorCode.INVALID_JSON, 400);
    return c.json(body, status);
  }

  const parsed = EntriesPostBodySchema.safeParse(raw);
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_BODY, 400, undefined, {
      issues: parsed.error.issues,
    });
    return c.json(body, status);
  }

  const result = createEntryFromCliInput(getDb(), {
    date: parsed.data.date,
    start: parsed.data.start,
    end: parsed.data.end,
    category: parsed.data.category,
    note: parsed.data.note ?? null,
  });

  if (result.ok) {
    notifySyncChange(getLatestSeq());
  }

  return c.json(result, result.ok ? 200 : 400);
});

export default entries;
