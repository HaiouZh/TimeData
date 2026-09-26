import { z } from "zod";

import { UtcIsoStringSchema } from "./schemas.js";

const NonNegativeIntSchema = z.number().int().nonnegative().finite();
const NonEmptyStringSchema = z.string().min(1);

export const AdminEntryAnomalySchema = z.enum(["invalid_time_range", "missing_category", "archived_category"]);
export const AdminBackupRetentionSchema = z.enum(["recent", "snapshot", "protected", "deletable"]);
export const AdminHealthCheckCodeSchema = z.enum(["invalid_time_range", "missing_category", "archived_category", "overlap"]);
export const AdminHealthSeveritySchema = z.enum(["warning", "error"]);
export const AdminAnalyticsGroupBySchema = z.enum(["day", "week", "month"]);
export const AdminRequestLogOutcomeSchema = z.enum([
  "ok",
  "auth_failed",
  "rate_limited",
  "server_error",
  "client_error",
]);
export const AdminRequestLogTokenTierSchema = z.enum([
  "public",
  "master",
  "agent",
  "dev_bypass",
  "missing",
  "invalid",
  "unknown",
]);
export const AdminRequestLogClientHintSchema = z.enum(["web", "android", "cli", "agent", "unknown"]);

export const AdminSummaryResponseSchema = z.object({
  generatedAt: UtcIsoStringSchema,
  counts: z.object({
    categories: NonNegativeIntSchema,
    activeCategories: NonNegativeIntSchema,
    archivedCategories: NonNegativeIntSchema,
    timeEntries: NonNegativeIntSchema,
    syncLogs: NonNegativeIntSchema,
    tombstones: NonNegativeIntSchema,
    serverBackups: NonNegativeIntSchema,
  }),
  latest: z.object({
    entryUpdatedAt: UtcIsoStringSchema.nullable(),
    syncLogTimestamp: UtcIsoStringSchema.nullable(),
    backupCreatedAt: UtcIsoStringSchema.nullable(),
  }),
});

export const AdminEntryRowSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  categoryName: z.string().nullable(),
  parentCategoryName: z.string().nullable(),
  startTime: UtcIsoStringSchema,
  endTime: UtcIsoStringSchema,
  durationMinutes: z.number().nullable(),
  note: z.string().nullable(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
  anomaly: AdminEntryAnomalySchema.nullable(),
});

export const AdminEntriesResponseSchema = z.object({
  entries: z.array(AdminEntryRowSchema),
  limit: NonNegativeIntSchema,
  offset: NonNegativeIntSchema,
  total: NonNegativeIntSchema,
});

export const AdminCategoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  parentName: z.string().nullable(),
  color: z.string(),
  icon: z.string().nullable(),
  sortOrder: z.number(),
  isArchived: z.boolean(),
  entryCount: z.number(),
  totalMinutes: z.number(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});

export const AdminCategoriesResponseSchema = z.object({
  categories: z.array(AdminCategoryRowSchema),
});

export const AdminSyncLogRowSchema = z.object({
  id: z.number(),
  timestamp: UtcIsoStringSchema,
  device: z.string().nullable(),
  action: z.string(),
  detail: z.string().nullable(),
  recordCount: z.number(),
});

export const AdminSyncIssueRowSchema = z.object({
  logId: z.number(),
  timestamp: UtcIsoStringSchema,
  action: z.string(),
  tableName: z.enum(["categories", "time_entries"]),
  localRecordId: z.string(),
  reasonCode: z.string(),
  message: z.string(),
  overriddenRecordIds: z.array(z.string()),
  backupId: z.string().nullable(),
});

export const AdminSyncResponseSchema = z.object({
  logs: z.array(AdminSyncLogRowSchema),
  recentRejectedCount: z.number(),
  recentConflictCount: z.number(),
  recentIssues: z.array(AdminSyncIssueRowSchema),
});

export const AdminBackupRowSchema = z.object({
  id: NonEmptyStringSchema,
  fileName: NonEmptyStringSchema,
  operation: NonEmptyStringSchema,
  sizeBytes: NonNegativeIntSchema,
  createdAt: UtcIsoStringSchema,
  protected: z.boolean(),
  reason: z.string().nullable(),
  retention: AdminBackupRetentionSchema,
  relatedSyncLogId: NonNegativeIntSchema.nullable(),
});

export const AdminBackupsResponseSchema = z.object({
  backups: z.array(AdminBackupRowSchema),
});

export const BackupConfigSchema = z.object({
  dailyBackup: z.object({
    enabled: z.boolean(),
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
  }),
  retentionDays: z.number().int().min(1).max(3650),
});

export const AdminBackupConfigResponseSchema = z.object({ config: BackupConfigSchema });

export const AdminRunDailyResponseSchema = z.object({
  created: z.boolean(),
  backupId: z.string().nullable(),
  reason: z.enum(["created", "disabled", "before_time", "already_today", "no_change"]),
});

export const AdminHealthCheckItemSchema = z.object({
  code: AdminHealthCheckCodeSchema,
  severity: AdminHealthSeveritySchema,
  count: z.number(),
  sampleIds: z.array(z.string()),
});

export const AdminHealthChecksResponseSchema = z.object({
  generatedAt: UtcIsoStringSchema,
  checks: z.array(AdminHealthCheckItemSchema),
});

export const AdminAnalyticsBucketSchema = z.object({
  bucket: z.string(),
  totalMinutes: z.number(),
  entryCount: z.number(),
});

export const AdminAnalyticsCategoryBucketSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  parentCategoryName: z.string().nullable(),
  totalMinutes: z.number(),
  entryCount: z.number(),
  color: z.string(),
});

export const AdminAnalyticsResponseSchema = z.object({
  range: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    groupBy: AdminAnalyticsGroupBySchema,
  }),
  byTime: z.array(AdminAnalyticsBucketSchema),
  byCategory: z.array(AdminAnalyticsCategoryBucketSchema),
});

export const AdminRequestLogRowSchema = z.object({
  id: z.number().int().positive(),
  timestamp: UtcIsoStringSchema,
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  outcome: AdminRequestLogOutcomeSchema,
  tokenTier: AdminRequestLogTokenTierSchema,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  clientHint: AdminRequestLogClientHintSchema,
  deviceLabel: z.string().nullable(),
  durationMs: NonNegativeIntSchema,
  isNewIp: z.boolean(),
  // 归属地不落库,由服务端查询时实时查 GeoLite2 填充;库缺失或查不到即 null。
  country: z.string().nullable(),
  city: z.string().nullable(),
  asnOrg: z.string().nullable(),
});

export const AdminRequestLogsResponseSchema = z.object({
  logs: z.array(AdminRequestLogRowSchema),
  limit: z.number().int().positive(),
});

// 异地冷备：宿主机 cron 每次推送往数据目录 backup_runs.jsonl 追加一行（写入方在 Run 仓 deploy/backup/）。
// at / remote 里的时刻是脚本写的秒级 UTC ISO（无毫秒），故不用 UtcIsoStringSchema。
export const OffsiteBackupVerdictSchema = z.enum(["none", "ok", "stale", "failed"]);

export const OffsiteBackupRunSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  remote: z.string().nullable(),
});

export const AdminOffsiteBackupResponseSchema = z.object({
  verdict: OffsiteBackupVerdictSchema,
  reason: z.string().nullable(),
  last: OffsiteBackupRunSchema.nullable(),
  // 最近 7 行，新的在前
  recent: z.array(OffsiteBackupRunSchema),
});

export type AdminSummaryResponse = z.infer<typeof AdminSummaryResponseSchema>;
export type AdminEntryRow = z.infer<typeof AdminEntryRowSchema>;
export type AdminEntriesResponse = z.infer<typeof AdminEntriesResponseSchema>;
export type AdminCategoryRow = z.infer<typeof AdminCategoryRowSchema>;
export type AdminCategoriesResponse = z.infer<typeof AdminCategoriesResponseSchema>;
export type AdminSyncLogRow = z.infer<typeof AdminSyncLogRowSchema>;
export type AdminSyncIssueRow = z.infer<typeof AdminSyncIssueRowSchema>;
export type AdminSyncResponse = z.infer<typeof AdminSyncResponseSchema>;
export type AdminBackupRow = z.infer<typeof AdminBackupRowSchema>;
export type AdminBackupsResponse = z.infer<typeof AdminBackupsResponseSchema>;
export type BackupConfig = z.infer<typeof BackupConfigSchema>;
export type AdminBackupConfigResponse = z.infer<typeof AdminBackupConfigResponseSchema>;
export type AdminRunDailyResponse = z.infer<typeof AdminRunDailyResponseSchema>;
export type AdminHealthCheckItem = z.infer<typeof AdminHealthCheckItemSchema>;
export type AdminHealthChecksResponse = z.infer<typeof AdminHealthChecksResponseSchema>;
export type AdminAnalyticsBucket = z.infer<typeof AdminAnalyticsBucketSchema>;
export type AdminAnalyticsCategoryBucket = z.infer<typeof AdminAnalyticsCategoryBucketSchema>;
export type AdminAnalyticsResponse = z.infer<typeof AdminAnalyticsResponseSchema>;
export type AdminRequestLogOutcome = z.infer<typeof AdminRequestLogOutcomeSchema>;
export type AdminRequestLogTokenTier = z.infer<typeof AdminRequestLogTokenTierSchema>;
export type AdminRequestLogClientHint = z.infer<typeof AdminRequestLogClientHintSchema>;
export type AdminRequestLogRow = z.infer<typeof AdminRequestLogRowSchema>;
export type AdminRequestLogsResponse = z.infer<typeof AdminRequestLogsResponseSchema>;
export type OffsiteBackupVerdict = z.infer<typeof OffsiteBackupVerdictSchema>;
export type OffsiteBackupRun = z.infer<typeof OffsiteBackupRunSchema>;
export type AdminOffsiteBackupResponse = z.infer<typeof AdminOffsiteBackupResponseSchema>;
