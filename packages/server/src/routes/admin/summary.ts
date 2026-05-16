import type { AdminSummaryResponse } from "@timedata/shared";
import { Hono } from "hono";
import { getDb } from "../../db/connection.js";
import { count, listServerBackups, type MaxRow } from "./_helpers.js";

const summary = new Hono();

summary.get("/", (c) => {
  const backups = listServerBackups();
  const entryUpdatedAt = (getDb().prepare("SELECT MAX(updated_at) AS value FROM time_entries").get() as MaxRow).value;
  const syncLogTimestamp = (getDb().prepare("SELECT MAX(timestamp) AS value FROM sync_logs").get() as MaxRow).value;

  const response: AdminSummaryResponse = {
    generatedAt: new Date().toISOString(),
    counts: {
      categories: count("SELECT COUNT(*) AS count FROM categories"),
      activeCategories: count("SELECT COUNT(*) AS count FROM categories WHERE is_archived = 0"),
      archivedCategories: count("SELECT COUNT(*) AS count FROM categories WHERE is_archived = 1"),
      timeEntries: count("SELECT COUNT(*) AS count FROM time_entries"),
      syncLogs: count("SELECT COUNT(*) AS count FROM sync_logs"),
      tombstones: count("SELECT COUNT(*) AS count FROM sync_tombstones"),
      serverBackups: backups.length,
    },
    latest: {
      entryUpdatedAt,
      syncLogTimestamp,
      backupCreatedAt: backups[0]?.createdAt ?? null,
    },
  };

  return c.json(response);
});

export default summary;
