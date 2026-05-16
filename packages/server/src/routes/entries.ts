import { Hono } from "hono";
import { getDb } from "../db/connection.js";
import { type EntryRow, rowToEntry } from "../lib/db-rows.js";
import { createEntryFromCliInput, listEntriesForCliDate, nextDate } from "../lib/entry-service.js";
import { localDateTimeToUtc } from "@timedata/shared";

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

entries.post("/", async (c) => {
  let body: {
    date?: string;
    start?: string;
    end?: string;
    category?: string;
    note?: string | null;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } }, 400);
  }

  const result = createEntryFromCliInput(getDb(), {
    date: body.date || "",
    start: body.start || "",
    end: body.end || "",
    category: body.category || "",
    note: body.note || null,
  });

  return c.json(result, result.ok ? 200 : 400);
});

export default entries;
