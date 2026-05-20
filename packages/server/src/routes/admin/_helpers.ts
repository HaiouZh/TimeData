import fs from "node:fs";
import path from "node:path";
import type { AdminAnalyticsResponse, AdminBackupRow, AdminEntryRow, AdminHealthCheckItem } from "@timedata/shared";
import { getDb, getDbPath } from "../../db/connection.js";
import { currentAppLocalDateTimeString } from "../../lib/timezone.js";
import { readBackupManifest } from "../../sync/backup.js";

export type CountRow = { count: number };
export type MaxRow = { value: string | null };

export type EntryRow = {
  id: string;
  category_id: string;
  category_name: string | null;
  parent_category_name: string | null;
  category_archived: number | null;
  start_time: string;
  end_time: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  parent_name: string | null;
  color: string;
  icon: string | null;
  sort_order: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  entry_count: number;
  total_minutes: number | null;
};

export type SyncLogDbRow = {
  id: number;
  timestamp: string;
  device: string | null;
  action: string;
  detail: string | null;
  record_count: number | null;
};

export type HealthSampleRow = { id: string };
export type AnalyticsTimeRow = { bucket: string; total_minutes: number | null; entry_count: number };
export type AnalyticsCategoryRow = {
  category_id: string;
  category_name: string;
  parent_category_name: string | null;
  total_minutes: number | null;
  entry_count: number;
  color: string;
};

type BackupManifestEntry = {
  id: string;
  fileName: string;
  operation: string;
  createdAt: string;
  protected: boolean;
  reason: string | null;
  relatedSyncLogId: number | null;
  details: Record<string, unknown> | null;
};

export const allowedAnomalies = new Set(["invalid_time_range", "missing_category", "archived_category"]);

export function count(sql: string, params: unknown[] = []): number {
  return (
    getDb()
      .prepare(sql)
      .get(...params) as CountRow
  ).count;
}

export function parsePositiveInteger(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

export function dateStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

export function dateEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

export function durationMinutes(startTime: string, endTime: string): number | null {
  if (endTime <= startTime) return null;
  return Math.round((Date.parse(endTime) - Date.parse(startTime)) / 60000);
}

export function entryAnomaly(row: EntryRow): AdminEntryRow["anomaly"] {
  if (row.end_time <= row.start_time || row.end_time > currentAppLocalDateTimeString()) return "invalid_time_range";
  if (!row.category_name) return "missing_category";
  if (row.category_archived === 1) return "archived_category";
  return null;
}

export function mapEntry(row: EntryRow): AdminEntryRow {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    parentCategoryName: row.parent_category_name,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes: durationMinutes(row.start_time, row.end_time),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    anomaly: entryAnomaly(row),
  };
}

function parseBackupCreatedAt(fileName: string): string | null {
  const match = fileName.match(/-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db$/);
  if (!match) return null;
  return match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
}

function parseBackupOperation(fileName: string): string {
  return fileName.replace(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/, "");
}

export function listServerBackups(): AdminBackupRow[] {
  const backupDir = path.join(path.dirname(getDbPath()), "backups");
  const manifest = readBackupManifest();
  const manifestByFileName = new Map<string, BackupManifestEntry>(
    Object.values(manifest.backups).map((entry) => [entry.fileName, entry]),
  );

  if (!fs.existsSync(backupDir)) return [];

  return fs
    .readdirSync(backupDir)
    .filter((fileName) => fileName.endsWith(".db"))
    .flatMap((fileName): AdminBackupRow[] => {
      const fullPath = path.join(backupDir, fileName);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch (error) {
        console.warn("[backup] unable to stat backup file", { fileName, error });
        return [];
      }
      const manifestEntry = manifestByFileName.get(fileName);
      const protectedBackup = manifestEntry?.protected ?? false;
      const retention: AdminBackupRow["retention"] = protectedBackup ? "protected" : "recent";
      return [
        {
          id: manifestEntry?.id ?? fileName,
          fileName,
          operation: manifestEntry?.operation ?? parseBackupOperation(fileName),
          sizeBytes: stat.size,
          createdAt: manifestEntry?.createdAt ?? parseBackupCreatedAt(fileName) ?? stat.mtime.toISOString(),
          protected: protectedBackup,
          reason: manifestEntry?.reason ?? null,
          retention,
          relatedSyncLogId: manifestEntry?.relatedSyncLogId ?? null,
        },
      ];
    })
    .sort((a, b) =>
      a.createdAt === b.createdAt ? a.fileName.localeCompare(b.fileName) : b.createdAt.localeCompare(a.createdAt),
    );
}

export function buildEntryFilters(from: string | undefined, to: string | undefined, anomaly: string | undefined) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (from) {
    conditions.push("e.start_time >= ?");
    params.push(dateStart(from));
  }
  if (to) {
    conditions.push("e.start_time <= ?");
    params.push(dateEnd(to));
  }
  if (anomaly && allowedAnomalies.has(anomaly)) {
    if (anomaly === "invalid_time_range") {
      conditions.push("(e.end_time <= e.start_time OR e.end_time > ?)");
      params.push(currentAppLocalDateTimeString());
    } else if (anomaly === "missing_category") {
      conditions.push("c.id IS NULL AND e.end_time > e.start_time");
    } else if (anomaly === "archived_category") {
      conditions.push("c.is_archived = 1 AND e.end_time > e.start_time");
    }
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function buildAnalyticsFilters(from: string | undefined, to: string | undefined) {
  const conditions: string[] = ["e.end_time > e.start_time"];
  const params: unknown[] = [];

  if (from) {
    conditions.push("e.start_time >= ?");
    params.push(dateStart(from));
  }
  if (to) {
    conditions.push("e.start_time <= ?");
    params.push(dateEnd(to));
  }

  return {
    whereSql: `WHERE ${conditions.join(" AND ")}`,
    params,
  };
}

export function analyticsBucketExpression(groupBy: AdminAnalyticsResponse["range"]["groupBy"]): string {
  return groupBy === "month" ? "substr(e.start_time, 1, 7)" : "substr(e.start_time, 1, 10)";
}

type HealthCheckQuery = {
  countSql: string;
  sampleSql: string;
  params?: unknown[];
};

export function getHealthCheck(
  code: AdminHealthCheckItem["code"],
  severity: AdminHealthCheckItem["severity"],
  query: HealthCheckQuery,
): AdminHealthCheckItem {
  const db = getDb();
  const params = query.params ?? [];
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM (${query.countSql})`).get(...params) as CountRow;
  const rows = db.prepare(`SELECT id FROM (${query.sampleSql}) LIMIT 5`).all(...params) as HealthSampleRow[];
  return {
    code,
    severity,
    count: countRow.count,
    sampleIds: rows.map((row) => row.id),
  };
}

export function parseSyncLogDetail(detail: string | null): unknown {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

export function readNumberField(parsed: unknown, key: string): number | null {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
  }
  return null;
}
