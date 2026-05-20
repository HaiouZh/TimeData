import { Hono } from "hono";
import { getDb } from "../db/connection.js";
import type { CategoryRow, EntryRow } from "../lib/db-rows.js";

const exportRoute = new Hono();

function escapeCsvCell(value: unknown): string {
  const v = value == null ? "" : String(value);
  const safe = /^[\s]*[=+\-@]/.test(v) ? `'${v}` : v;
  const needsQuote = /[",\r\n]/.test(safe);
  const escaped = safe.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

exportRoute.get("/", (c) => {
  const format = c.req.query("format") || "jsonl";
  const db = getDb();

  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order").all() as CategoryRow[];
  const entries = db.prepare("SELECT * FROM time_entries ORDER BY start_time").all() as EntryRow[];

  const categoryMap = new Map<string, string>();
  for (const cat of categories) {
    const parent = categories.find((p) => p.id === cat.parent_id);
    categoryMap.set(cat.id, parent ? `${parent.name}/${cat.name}` : cat.name);
  }

  if (format === "jsonl") {
    const lines: string[] = [];

    for (const cat of categories) {
      lines.push(
        JSON.stringify({
          type: "category",
          id: cat.id,
          name: cat.name,
          parentId: cat.parent_id,
          color: cat.color,
          sortOrder: cat.sort_order,
        }),
      );
    }

    for (const entry of entries) {
      lines.push(
        JSON.stringify({
          type: "entry",
          id: entry.id,
          category: categoryMap.get(entry.category_id) || "unknown",
          start: entry.start_time,
          end: entry.end_time,
          note: entry.note,
        }),
      );
    }

    c.header("Content-Disposition", "attachment; filename=timedata-export.jsonl");
    return c.body(`${lines.join("\n")}\n`, 200, { "Content-Type": "application/x-ndjson" });
  }

  if (format === "csv") {
    const csvLines = ["category,start,end,note"];
    for (const entry of entries) {
      const cat = categoryMap.get(entry.category_id) || "unknown";
      csvLines.push(
        [
          escapeCsvCell(cat),
          escapeCsvCell(entry.start_time),
          escapeCsvCell(entry.end_time),
          escapeCsvCell(entry.note),
        ].join(","),
      );
    }

    c.header("Content-Disposition", "attachment; filename=timedata-export.csv");
    return c.body(`${csvLines.join("\n")}\n`, 200, { "Content-Type": "text/csv" });
  }

  return c.json({ error: "Unsupported format. Use jsonl or csv." }, 400);
});

export default exportRoute;
