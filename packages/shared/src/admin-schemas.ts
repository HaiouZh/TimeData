import { z } from "zod";

import { UtcIsoStringSchema } from "./schemas.js";

const NonNegativeIntSchema = z.number().int().nonnegative().finite();
const NonEmptyStringSchema = z.string().min(1);

export const AdminEntryAnomalySchema = z.enum(["invalid_time_range", "missing_category", "archived_category"]);
export const AdminBackupRetentionSchema = z.enum(["recent", "snapshot", "protected", "deletable"]);
export const AdminHealthCheckCodeSchema = z.enum(["invalid_time_range", "missing_category", "archived_category", "overlap"]);
export const AdminHealthSeveritySchema = z.enum(["warning", "error"]);
export const AdminAnalyticsGroupBySchema = z.enum(["day", "week", "month"]);

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
export type AdminHealthCheckItem = z.infer<typeof AdminHealthCheckItemSchema>;
export type AdminHealthChecksResponse = z.infer<typeof AdminHealthChecksResponseSchema>;
export type AdminAnalyticsBucket = z.infer<typeof AdminAnalyticsBucketSchema>;
export type AdminAnalyticsCategoryBucket = z.infer<typeof AdminAnalyticsCategoryBucketSchema>;
export type AdminAnalyticsResponse = z.infer<typeof AdminAnalyticsResponseSchema>;
