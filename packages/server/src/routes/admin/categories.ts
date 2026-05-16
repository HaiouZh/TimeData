import type { AdminCategoriesResponse, AdminCategoryRow } from "@timedata/shared";
import { Hono } from "hono";
import { getDb } from "../../db/connection.js";
import type { CategoryRow } from "./_helpers.js";

const categories = new Hono();

categories.get("/", (c) => {
  const rows = getDb().prepare(`
    SELECT
      c.id,
      c.name,
      c.parent_id,
      p.name AS parent_name,
      c.color,
      c.icon,
      c.sort_order,
      c.is_archived,
      c.created_at,
      c.updated_at,
      COUNT(e.id) AS entry_count,
      COALESCE(SUM(CASE
        WHEN e.end_time > e.start_time THEN ROUND((julianday(e.end_time) - julianday(e.start_time)) * 24 * 60)
        ELSE 0
      END), 0) AS total_minutes
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    LEFT JOIN time_entries e ON e.category_id = c.id
    GROUP BY c.id
    ORDER BY c.is_archived, COALESCE(p.sort_order, c.sort_order), c.parent_id IS NOT NULL, c.sort_order, c.name, c.id
  `).all() as CategoryRow[];

  const response: AdminCategoriesResponse = {
    categories: rows.map((row): AdminCategoryRow => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      parentName: row.parent_name,
      color: row.color,
      icon: row.icon,
      sortOrder: row.sort_order,
      isArchived: Boolean(row.is_archived),
      entryCount: row.entry_count,
      totalMinutes: row.total_minutes ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };

  return c.json(response);
});

export default categories;
