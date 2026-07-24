import { z } from "zod";
import {
  CategorySchema,
  NonNegativeIntSchema,
  QuickNoteSchema,
  SettingSchema,
  TaskSchema,
  TimeEntrySchema,
  UtcIsoStringSchema,
} from "./entitySchemas.js";
import {
  SYNC_TABLE_NAMES,
  TASK_DELETE_REASONS,
  buildSyncChangeSchema,
  buildTaskCompletionOpSchema,
  buildTrackStatusOpSchema,
} from "./syncDomains.js";
import type { SyncChange } from "./types.js";

export {
  GoalMemberRefSchema,
  CategorySchema,
  GoalLayoutPinNodeKindSchema,
  GoalLayoutPinSchema,
  GoalPrerequisiteSchema,
  GoalSchema,
  QuickNoteSchema,
  RecurrenceSchema,
  RefSchema,
  SessionSchema,
  SettingSchema,
  TaskSchema,
  TimeEntrySchema,
  TrackSchema,
  TrackStepSchema,
  UtcIsoStringSchema,
} from "./entitySchemas.js";

const SeqSchema = NonNegativeIntSchema;

export const SyncLogEntrySchema = z.object({
  id: z.string(),
  tableName: z.enum(SYNC_TABLE_NAMES),
  recordId: z.string(),
  action: z.enum(["create", "update", "delete"]),
  timestamp: UtcIsoStringSchema,
  // 0=待上传 1=已同步/已放弃 2=隔离（服务端持续拒收的死信，不再自动重发，等用户修正或重新入队）
  synced: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  op: z.union([buildTaskCompletionOpSchema(UtcIsoStringSchema), buildTrackStatusOpSchema(UtcIsoStringSchema)]).optional(),
  deleteReason: z.enum(TASK_DELETE_REASONS).optional(),
});

// 运行时成员按登记簿生成；静态类型 SyncChange 在 types.ts 手工维护判别联合，二者由 schemas.test.ts 对齐。
export const SyncChangeSchema = buildSyncChangeSchema(UtcIsoStringSchema) as z.ZodType<SyncChange>;

export const SyncPushReasonCodeSchema = z.enum([
  "stale_change_rejected",
  "orphan_step_rejected",
  "missing_payload",
  "invalid_shape",
  "id_mismatch",
  "invalid_time_range",
  "missing_category",
  "archived_category",
  "overlap",
  "server_version_newer_or_same",
  "foreign_key_failed",
  "applied",
  "validated",
]);

export const SyncPushRequestSchema = z.object({
  changes: z.array(SyncChangeSchema),
  baseSeq: SeqSchema.nullable().optional(),
  requestId: z.string().trim().min(1).max(128).optional(), // 幂等键：同 id 重放原响应（对齐 agent-tracks 的 RequestIdSchema 约束）
});

// 账本模型：pull 只认 seq cursor；sinceSeq=0 或 null 表示全量。timestamp cursor（since/lastSyncedAt）已退役。
export const SyncPullRequestSchema = z.object({
  sinceSeq: SeqSchema.nullable(),
  limit: z.number().int().positive().optional(),
});

export const SyncForcePushPrepareRequestSchema = z.object({
  categoryCount: NonNegativeIntSchema,
  entryCount: NonNegativeIntSchema,
  quickNoteCount: NonNegativeIntSchema.default(0),
  lastUpdatedAt: UtcIsoStringSchema.nullable(),
});

export const SyncForcePushRequestSchema = z.object({
  confirmToken: z.string().min(1),
  confirmationPhrase: z.literal("OVERWRITE_SERVER"),
  categories: z.array(CategorySchema),
  timeEntries: z.array(TimeEntrySchema),
  settings: z.array(SettingSchema).optional(),
  quickNotes: z.array(QuickNoteSchema).default([]),
  tasks: z.array(TaskSchema).default([]),
});

export const SyncStatusResponseSchema = z.object({
  categoryCount: NonNegativeIntSchema,
  entryCount: NonNegativeIntSchema,
  quickNoteCount: NonNegativeIntSchema,
  lastUpdatedAt: UtcIsoStringSchema.nullable(),
  contentHash: z.string().min(1).optional(),
  latestSeq: SeqSchema.nullable().optional(),
  serverTime: UtcIsoStringSchema,
});

export const SyncPullResponseSchema = z.object({
  changes: z.array(SyncChangeSchema),
  serverTime: UtcIsoStringSchema,
  latestSeq: SeqSchema.nullable().optional(),
  nextSinceSeq: SeqSchema.nullable().optional(),
  hasMore: z.boolean().optional(),
});

// SSE bump 载荷：纯增量契约——旧客户端只读 latestSeq；fromSeq+changes 成对出现时收端可就地 apply（ADR 0021）。
export const SyncStreamBumpSchema = z.object({
  latestSeq: SeqSchema.nullable(),
  fromSeq: SeqSchema.optional(),
  changes: z.array(SyncChangeSchema).optional(),
});

export type SyncStreamBump = z.infer<typeof SyncStreamBumpSchema>;
