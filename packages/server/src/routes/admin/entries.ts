import type { AdminEntriesResponse } from "@timedata/shared";
import { Hono } from "hono";
import { getDb } from "../../db/connection.js";
import { type CountRow, type EntryRow, buildEntryFilters, mapEntry, parsePositiveInteger } from "./_helpers.js";

const entries = new Hono();

entries.get("/", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const anomaly = c.req.query("anomaly");
  const limit = parsePositiveInteger(c.req.query("limit"), 50, 200);
  const offset = parsePositiveInteger(c.req.query("offset"), 0);
  const { whereSql, params } = buildEntryFilters(from, to, anomaly);

  const total = (
    getDb()
      .prepare(`
    SELECT COUNT(*) AS count
    FROM time_entries e
    LEFT JOIN categories c ON c.id = e.category_id
    ${whereSql}
  `)
      .get(...params) as CountRow
  ).count;

  const rows = getDb()
    .prepare(`
    SELECT
      e.id,
      e.category_id,
      c.name AS category_name,
      p.name AS parent_category_name,
      c.is_archived AS category_archived,
      e.start_time,
      e.end_time,
      e.note,
      e.created_at,
      e.updated_at
    FROM time_entries e
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN categories p ON p.id = c.parent_id
    ${whereSql}
    ORDER BY e.start_time DESC, e.id DESC
    LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset) as EntryRow[];

  const response: AdminEntriesResponse = {
    entries: rows.map(mapEntry),
    limit,
    offset,
    total,
  };

  return c.json(response);
});

export default entries;
