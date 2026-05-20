import type { AdminAnalyticsCategoryBucket, AdminAnalyticsResponse } from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/connection.js";
import { validateQuery } from "../../middleware/validate.js";
import {
  type AnalyticsCategoryRow,
  type AnalyticsTimeRow,
  analyticsBucketExpression,
  buildAnalyticsFilters,
} from "./_helpers.js";

const analytics = new Hono();

const analyticsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  groupBy: z.enum(["day", "week", "month"]).default("day"),
});

analytics.get("/", validateQuery(analyticsQuerySchema), (c) => {
  const { from, to, groupBy } = c.var.query;
  const { whereSql, params } = buildAnalyticsFilters(from, to);
  const bucketExpression = analyticsBucketExpression(groupBy);

  const byTimeRows = getDb()
    .prepare(`
    SELECT
      ${bucketExpression} AS bucket,
      SUM(ROUND((julianday(e.end_time) - julianday(e.start_time)) * 24 * 60)) AS total_minutes,
      COUNT(*) AS entry_count
    FROM time_entries e
    ${whereSql}
    GROUP BY bucket
    ORDER BY bucket
  `)
    .all(...params) as AnalyticsTimeRow[];

  const byCategoryRows = getDb()
    .prepare(`
    SELECT
      e.category_id,
      COALESCE(c.name, e.category_id) AS category_name,
      p.name AS parent_category_name,
      SUM(ROUND((julianday(e.end_time) - julianday(e.start_time)) * 24 * 60)) AS total_minutes,
      COUNT(*) AS entry_count,
      COALESCE(c.color, '#808080') AS color
    FROM time_entries e
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN categories p ON p.id = c.parent_id
    ${whereSql}
    GROUP BY e.category_id, category_name, parent_category_name, COALESCE(c.color, '#808080')
    ORDER BY total_minutes DESC, category_name, category_id
  `)
    .all(...params) as AnalyticsCategoryRow[];

  const response: AdminAnalyticsResponse = {
    range: {
      from: from ?? null,
      to: to ?? null,
      groupBy,
    },
    byTime: byTimeRows.map((row) => ({
      bucket: row.bucket,
      totalMinutes: row.total_minutes ?? 0,
      entryCount: row.entry_count,
    })),
    byCategory: byCategoryRows.map(
      (row): AdminAnalyticsCategoryBucket => ({
        categoryId: row.category_id,
        categoryName: row.category_name,
        parentCategoryName: row.parent_category_name,
        totalMinutes: row.total_minutes ?? 0,
        entryCount: row.entry_count,
        color: row.color,
      }),
    ),
  };

  return c.json(response);
});

export default analytics;
