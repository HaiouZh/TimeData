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

export type {
  AdminAnalyticsBucket,
  AdminAnalyticsCategoryBucket,
  AdminAnalyticsResponse,
  AdminBackupRow,
  AdminBackupsResponse,
  AdminCategoriesResponse,
  AdminCategoryRow,
  AdminEntriesResponse,
  AdminEntryRow,
  AdminHealthCheckItem,
  AdminHealthChecksResponse,
  AdminSummaryResponse,
  AdminSyncIssueRow,
  AdminSyncLogRow,
  AdminSyncResponse,
} from "./admin-schemas.js";

export type SyncReasonCategory =
  | "applied"
  | "client_bug" // missing_payload / invalid_shape / id_mismatch — 客户端 bug，标 synced + 上报
  | "user_actionable" // archived_category / missing_category / overlap / invalid_time_range — 用户处理
  | "conflict" // server_version_newer_or_same — 进入冲突流程
  | "unknown";
