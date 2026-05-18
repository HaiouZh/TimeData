import type { AdminEntriesResponse } from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/connection.js";
import { validateQuery } from "../../middleware/validate.js";
import { type CountRow, type EntryRow, allowedAnomalies, buildEntryFilters, mapEntry } from "./_helpers.js";

const entries = new Hono();

const entriesQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  anomaly: z.enum([...allowedAnomalies] as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(0).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

entries.get("/", validateQuery(entriesQuerySchema), (c) => {
  const { from, to, anomaly, limit, offset } = c.var.query;
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
