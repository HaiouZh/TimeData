import type { AdminHealthCheckItem, AdminHealthChecksResponse } from "@timedata/shared";
import { Hono } from "hono";
import { currentAppLocalDateTimeString } from "../../lib/timezone.js";
import { getHealthCheck } from "./_helpers.js";

const health = new Hono();

health.get("/", (c) => {
  const checks: AdminHealthCheckItem[] = [
    getHealthCheck(
      "invalid_time_range",
      "error",
      "SELECT id FROM time_entries WHERE end_time <= start_time OR end_time > ? ORDER BY start_time, id",
      [currentAppLocalDateTimeString()],
    ),
    getHealthCheck(
      "missing_category",
      "error",
      `
        SELECT e.id
        FROM time_entries e
        LEFT JOIN categories c ON c.id = e.category_id
        WHERE c.id IS NULL
        ORDER BY e.start_time, e.id
      `,
    ),
    getHealthCheck(
      "archived_category",
      "warning",
      `
        SELECT e.id
        FROM time_entries e
        JOIN categories c ON c.id = e.category_id
        WHERE c.is_archived = 1
        ORDER BY e.start_time, e.id
      `,
    ),
    getHealthCheck(
      "overlap",
      "warning",
      `
        SELECT DISTINCT e1.id
        FROM time_entries e1
        JOIN time_entries e2
          ON e1.id <> e2.id
         AND e1.start_time < e2.end_time
         AND e1.end_time > e2.start_time
        WHERE e1.end_time > e1.start_time
          AND e2.end_time > e2.start_time
        ORDER BY e1.start_time, e1.id
      `,
    ),
  ];

  const response: AdminHealthChecksResponse = {
    generatedAt: new Date().toISOString(),
    checks,
  };

  return c.json(response);
});

export default health;
