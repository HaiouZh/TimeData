import { z } from "zod";
import {
  CategorySchema,
  NonNegativeIntSchema,
  QuickNoteSchema,
  SettingSchema,
  TimeEntrySchema,
  UtcIsoStringSchema,
} from "./entitySchemas.js";
import { SYNC_TABLE_NAMES, buildSyncChangeSchema } from "./syncDomains.js";
import type { SyncChange } from "./types.js";

export { CategorySchema, QuickNoteSchema, RecurrenceSchema, SettingSchema, TaskSchema, TimeEntrySchema, UtcIsoStringSchema } from "./entitySchemas.js";

const SeqSchema = NonNegativeIntSchema;

export const SyncLogEntrySchema = z.object({
  id: z.string(),
  tableName: z.enum(SYNC_TABLE_NAMES),
  recordId: z.string(),
  action: z.enum(["create", "update", "delete"]),
  timestamp: UtcIsoStringSchema,
  synced: z.union([z.literal(0), z.literal(1)]),
});

// 运行时成员按登记簿生成；静态类型 SyncChange 在 types.ts 手工维护判别联合，二者由 schemas.test.ts 对齐。
export const SyncChangeSchema = buildSyncChangeSchema(UtcIsoStringSchema) as z.ZodType<SyncChange>;

export const SyncPushReasonCodeSchema = z.enum([
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
]);

export const SyncPushRequestSchema = z.object({
  changes: z.array(SyncChangeSchema),
  baseSeq: SeqSchema.nullable().optional(),
});

// 账本模型：pull 只认 seq cursor；sinceSeq=0 或 null 表示全量。timestamp cursor（since/lastSyncedAt）已退役。
export const SyncPullRequestSchema = z.object({
  sinceSeq: SeqSchema.nullable(),
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
});
