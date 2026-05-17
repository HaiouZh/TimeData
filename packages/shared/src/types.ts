import { z } from "zod";

import {
  CategorySchema,
  SyncChangeSchema,
  SyncForcePushPrepareRequestSchema,
  SyncForcePushRequestSchema,
  SyncLogEntrySchema,
  SyncPullRequestSchema,
  SyncPullResponseSchema,
  SyncStatusResponseSchema,
  SyncPushReasonCodeSchema,
  SyncPushRequestSchema,
  TimeEntrySchema,
} from "./schemas.js";

export type Category = z.infer<typeof CategorySchema>;

export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export type SyncLogEntry = z.infer<typeof SyncLogEntrySchema>;

export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export type SyncPullRequest = z.infer<typeof SyncPullRequestSchema>;

export type SyncForcePushPrepareRequest = z.infer<typeof SyncForcePushPrepareRequestSchema>;

export type SyncForcePushRequest = z.infer<typeof SyncForcePushRequestSchema>;

export type SyncChange = z.infer<typeof SyncChangeSchema>;

export type SyncPushOutcomeStatus = "accepted" | "rejected" | "conflict";

export type SyncPushReasonCode = z.infer<typeof SyncPushReasonCodeSchema>;

export interface SyncPushOutcome {
  tableName: SyncChange["tableName"];
  recordId: string;
  action: SyncChange["action"];
  status: SyncPushOutcomeStatus;
  reasonCode: SyncPushReasonCode;
  message: string;
  incomingTimestamp: string;
  serverUpdatedAt?: string;
  overriddenRecordIds?: string[];
  backupId?: string;
}

export interface SyncPushResponse {
  outcomes: SyncPushOutcome[];
  accepted: number;
  rejected: number;
  conflicts: number;
  backupId: string | null;
  serverTime: string;
}

export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

export interface SyncDatasetStatus {
  categoryCount: number;
  entryCount: number;
  lastUpdatedAt: string | null;
  contentHash?: string;
  latestSeq?: number | null;
}

export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;

export interface SyncForcePushPrepareResponse {
  confirmToken: string;
  expiresAt: string;
  confirmationPhrase: "OVERWRITE_SERVER";
  serverStatus: SyncStatusResponse;
}

export interface SyncForcePushResponse {
  importedCategories: number;
  importedTimeEntries: number;
  backupId: string;
  serverTime: string;
  latestSeq?: number | null;
}

export interface SyncHealthReport {
  local: SyncDatasetStatus & { unsyncedCount: number };
  server: SyncStatusResponse;
  recommendation: "pull_from_server" | "push_to_server" | "resolve_unsynced_changes" | "already_aligned";
  reason: string;
}

export interface DataResetPrepareResponse {
  confirmToken: string;
  confirmationPhrase: "RESET_DATA";
  expiresAt: string;
}

export interface ExportData {
  type: "category" | "entry";
  [key: string]: unknown;
}

export interface VersionInfo {
  current: string;     // 当前运行的 GIT_SHA 前 7 位，'dev' 表示开发模式
  latest: string;      // GitHub Actions 最近成功 build 的 head_sha 前 7 位
  hasUpdate: boolean;  // current !== latest && current !== 'dev'
  checkedAt: string;   // ISO 时间戳，便于前端显示
}

export interface AdminSummaryResponse {
  generatedAt: string;
  counts: {
    categories: number;
    activeCategories: number;
    archivedCategories: number;
    timeEntries: number;
    syncLogs: number;
    tombstones: number;
    serverBackups: number;
  };
  latest: {
    entryUpdatedAt: string | null;
    syncLogTimestamp: string | null;
    backupCreatedAt: string | null;
  };
}

export interface AdminEntryRow {
  id: string;
  categoryId: string;
  categoryName: string | null;
  parentCategoryName: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  anomaly: "invalid_time_range" | "missing_category" | "archived_category" | null;
}

export interface AdminEntriesResponse {
  entries: AdminEntryRow[];
  limit: number;
  offset: number;
  total: number;
}

export interface AdminCategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  color: string;
  icon: string | null;
  sortOrder: number;
  isArchived: boolean;
  entryCount: number;
  totalMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCategoriesResponse {
  categories: AdminCategoryRow[];
}

export interface AdminSyncLogRow {
  id: number;
  timestamp: string;
  device: string | null;
  action: string;
  detail: string | null;
  recordCount: number;
}

export interface AdminSyncIssueRow {
  logId: number;
  timestamp: string;
  action: string;
  tableName: "categories" | "time_entries";
  localRecordId: string;
  reasonCode: string;
  message: string;
  overriddenRecordIds: string[];
  backupId: string | null;
}

export interface AdminSyncResponse {
  logs: AdminSyncLogRow[];
  recentRejectedCount: number;
  recentConflictCount: number;
  recentIssues: AdminSyncIssueRow[];
}

export interface AdminBackupRow {
  id: string;
  fileName: string;
  operation: string;
  sizeBytes: number;
  createdAt: string;
  protected: boolean;
  reason: string | null;
  retention: "recent" | "snapshot" | "protected" | "deletable";
  relatedSyncLogId: number | null;
}

export interface AdminBackupsResponse {
  backups: AdminBackupRow[];
}

export interface AdminHealthCheckItem {
  code: "invalid_time_range" | "missing_category" | "archived_category" | "overlap";
  severity: "warning" | "error";
  count: number;
  sampleIds: string[];
}

export interface AdminHealthChecksResponse {
  generatedAt: string;
  checks: AdminHealthCheckItem[];
}

export interface AdminAnalyticsBucket {
  bucket: string;
  totalMinutes: number;
  entryCount: number;
}

export interface AdminAnalyticsCategoryBucket {
  categoryId: string;
  categoryName: string;
  parentCategoryName: string | null;
  totalMinutes: number;
  entryCount: number;
  color: string;
}

export interface AdminAnalyticsResponse {
  range: {
    from: string | null;
    to: string | null;
    groupBy: "day" | "week" | "month";
  };
  byTime: AdminAnalyticsBucket[];
  byCategory: AdminAnalyticsCategoryBucket[];
}
