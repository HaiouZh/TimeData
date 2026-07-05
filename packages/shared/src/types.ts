import type { z } from "zod";

import type {
  CategorySchema,
  GoalLayoutPinNodeKindSchema,
  GoalLayoutPinSchema,
  GoalMemberRefSchema,
  GoalPrerequisiteSchema,
  GoalSchema,
  QuickNoteSchema,
  RecurrenceSchema,
  SettingSchema,
  SyncForcePushPrepareRequestSchema,
  SyncForcePushRequestSchema,
  SyncLogEntrySchema,
  SyncPullRequestSchema,
  SyncPullResponseSchema,
  SyncPushReasonCodeSchema,
  SyncPushRequestSchema,
  SyncStatusResponseSchema,
  TaskSchema,
  TimeEntrySchema,
  TrackSchema,
  TrackStepSchema,
  RefSchema,
} from "./schemas.js";
import type { HealthChartConfig } from "./chartSchemas.js";
import type { HealthHeartRate, HealthHrv, HealthSleep, HealthStress, HealthRun } from "./healthSchemas.js";

export type Category = z.infer<typeof CategorySchema>;

export type GoalMemberRef = z.infer<typeof GoalMemberRefSchema>;

export type GoalPrerequisite = z.infer<typeof GoalPrerequisiteSchema>;

export type Goal = z.infer<typeof GoalSchema>;

export type GoalLayoutPinNodeKind = z.infer<typeof GoalLayoutPinNodeKindSchema>;

export type GoalLayoutPin = z.infer<typeof GoalLayoutPinSchema>;

export type QuickNote = z.infer<typeof QuickNoteSchema>;

export type Setting = z.infer<typeof SettingSchema>;

export type Recurrence = z.infer<typeof RecurrenceSchema>;

export type Task = z.infer<typeof TaskSchema>;

export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export type Ref = z.infer<typeof RefSchema>;

export type Track = z.infer<typeof TrackSchema>;

export type TrackStep = z.infer<typeof TrackStepSchema>;

export type SyncLogEntry = z.infer<typeof SyncLogEntrySchema>;

export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export type SyncPullRequest = z.infer<typeof SyncPullRequestSchema>;

export type SyncForcePushPrepareRequest = z.infer<typeof SyncForcePushPrepareRequestSchema>;

export type SyncForcePushRequest = z.infer<typeof SyncForcePushRequestSchema>;

/** tasks 完成语义 op：客户端有意改完成字段时附带；服务端凭它决定守卫列是否进 SET。 */
export interface TaskCompletionOp {
  type: "complete" | "reopen" | "skip" | "amend";
  at: string;
}

/** tracks status 语义 op：客户端/agent 有意改 status 时附带；服务端凭它决定守卫列是否进 SET。 */
export interface TrackStatusOp {
  type: "status";
  at: string;
}

interface SyncUpsertChange<Table extends string, Data> {
  tableName: Table;
  recordId: string;
  timestamp: string;
  action: "create" | "update";
  data: Data;
}

interface SyncDeleteChange<Table extends string> {
  tableName: Table;
  recordId: string;
  timestamp: string;
  action: "delete";
  data: null;
}

// 手工维护的判别联合：运行时校验由登记簿（syncDomains.ts）生成，新增域时两处一起改。
export type SyncChange =
  | SyncUpsertChange<"categories", Category>
  | SyncDeleteChange<"categories">
  | SyncUpsertChange<"time_entries", TimeEntry>
  | SyncDeleteChange<"time_entries">
  | SyncUpsertChange<"settings", Setting>
  | SyncDeleteChange<"settings">
  | SyncUpsertChange<"quick_notes", QuickNote>
  | SyncDeleteChange<"quick_notes">
  | (SyncUpsertChange<"tasks", Task> & { op?: TaskCompletionOp })
  | SyncDeleteChange<"tasks">
  | SyncUpsertChange<"health_heart_rate", HealthHeartRate>
  | SyncDeleteChange<"health_heart_rate">
  | SyncUpsertChange<"health_hrv", HealthHrv>
  | SyncDeleteChange<"health_hrv">
  | SyncUpsertChange<"health_sleep", HealthSleep>
  | SyncDeleteChange<"health_sleep">
  | SyncUpsertChange<"health_stress", HealthStress>
  | SyncDeleteChange<"health_stress">
  | SyncUpsertChange<"runs", HealthRun>
  | SyncDeleteChange<"runs">
  | SyncUpsertChange<"health_charts", HealthChartConfig>
  | SyncDeleteChange<"health_charts">
  | (SyncUpsertChange<"tracks", Track> & { op?: TrackStatusOp })
  | SyncDeleteChange<"tracks">
  | SyncUpsertChange<"track_steps", TrackStep>
  | SyncDeleteChange<"track_steps">
  | SyncUpsertChange<"goals", Goal>
  | SyncDeleteChange<"goals">
  | SyncUpsertChange<"goal_layout_pins", GoalLayoutPin>
  | SyncDeleteChange<"goal_layout_pins">;

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
  latestSeq?: number | null;
  appliedCount?: number;
}

export interface SyncBackupResponse {
  backupId: string;
}

export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

export interface SyncDatasetStatus {
  categoryCount: number;
  entryCount: number;
  quickNoteCount: number;
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
  importedSettings?: number;
  importedQuickNotes: number;
  importedTasks: number;
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
  /** 当前运行的 GIT_SHA 前 7 位，'dev' 表示开发模式 */
  current: string;
  /** GitHub Actions 最近成功 build 的 head_sha 前 7 位 */
  latest: string;
  /** current !== latest && current !== 'dev' && checkOk */
  hasUpdate: boolean;
  /** ISO 时间戳，便于前端显示 */
  checkedAt: string;
  /** GitHub 最新版是否查到；false 表示查询失败/限流，latest 不可信，不能据此判定「已最新」 */
  checkOk: boolean;
}

export type {
  AdminAnalyticsBucket,
  AdminAnalyticsCategoryBucket,
  AdminAnalyticsResponse,
  AdminBackupRow,
  AdminBackupsResponse,
  AdminBackupConfigResponse,
  AdminCategoriesResponse,
  AdminCategoryRow,
  AdminEntriesResponse,
  AdminEntryRow,
  AdminHealthCheckItem,
  AdminHealthChecksResponse,
  AdminRequestLogClientHint,
  AdminRequestLogOutcome,
  AdminRequestLogRow,
  AdminRequestLogsResponse,
  AdminRequestLogTokenTier,
  AdminRunDailyResponse,
  AdminSummaryResponse,
  AdminSyncIssueRow,
  AdminSyncLogRow,
  AdminSyncResponse,
  BackupConfig,
} from "./admin-schemas.js";

export type SyncReasonCategory =
  | "applied"
  | "client_bug" // missing_payload / invalid_shape / id_mismatch — 客户端 bug，标 synced + 上报
  | "user_actionable" // archived_category / missing_category / overlap / invalid_time_range — 用户处理
  | "stale_rejected" // stale_change_rejected / orphan_step_rejected — 服务端拒收过期或孤儿变更，客户端放弃本地主张、标 synced
  | "conflict" // server_version_newer_or_same — 进入冲突流程
  | "unknown";

export type { HealthHeartRate, HealthHrv, HealthSleep, HealthStress, HealthRun } from "./healthSchemas.js";
