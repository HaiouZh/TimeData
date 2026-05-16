import type { AdminSyncIssueRow, AdminSyncLogRow, AdminSyncResponse } from "@timedata/shared";
import { Hono } from "hono";
import { getDb } from "../../db/connection.js";
import { parseSyncLogDetail, readNumberField, type SyncLogDbRow } from "./_helpers.js";

const sync = new Hono();

sync.get("/", (c) => {
  const rows = getDb().prepare(`
    SELECT id, timestamp, device, action, detail, record_count
    FROM sync_logs
    ORDER BY timestamp DESC, id DESC
    LIMIT 50
  `).all() as SyncLogDbRow[];

  const logs = rows.map((row): AdminSyncLogRow => ({
    id: row.id,
    timestamp: row.timestamp,
    device: row.device,
    action: row.action,
    detail: row.detail,
    recordCount: row.record_count ?? 0,
  }));

  const recentIssues: AdminSyncIssueRow[] = [];
  let recentRejectedCount = 0;
  let recentConflictCount = 0;

  for (const row of rows) {
    const parsed = parseSyncLogDetail(row.detail);
    const rejected = readNumberField(parsed, "rejected");
    const conflicts = readNumberField(parsed, "conflicts");
    if ((rejected != null && rejected > 0) || row.action.includes("rejected")) recentRejectedCount += 1;
    if ((conflicts != null && conflicts > 0) || row.action.includes("conflict")) recentConflictCount += 1;
    const items = parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { outcomes?: unknown }).outcomes)
      ? (parsed as { outcomes: Array<Record<string, unknown>> }).outcomes
      : Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : null;

    if (!items) continue;

    for (const outcome of items) {
      const status = typeof outcome.status === "string" ? outcome.status : "";
      const reasonCode = typeof outcome.reasonCode === "string" ? outcome.reasonCode : "";
      const tableName = outcome.tableName === "categories" || outcome.tableName === "time_entries" ? outcome.tableName : null;
      const localRecordId = typeof outcome.recordId === "string" ? outcome.recordId : null;
      if (!tableName || !localRecordId) continue;

      const overriddenRecordIds = Array.isArray(outcome.overriddenRecordIds)
        ? outcome.overriddenRecordIds.filter((value): value is string => typeof value === "string")
        : [];
      const backupId = typeof outcome.backupId === "string" ? outcome.backupId : null;
      const message = typeof outcome.message === "string" ? outcome.message : row.action;

      if (status === "rejected" || status === "conflict" || overriddenRecordIds.length) {
        recentIssues.push({
          logId: row.id,
          timestamp: row.timestamp,
          action: row.action,
          tableName,
          localRecordId,
          reasonCode,
          message,
          overriddenRecordIds,
          backupId,
        });
      }
    }
  }

  const response: AdminSyncResponse = {
    logs,
    recentRejectedCount,
    recentConflictCount,
    recentIssues: recentIssues.slice(0, 20),
  };

  return c.json(response);
});

export default sync;
