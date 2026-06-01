import { z } from "zod";

export const UtcIsoStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }, "Invalid UTC ISO timestamp");
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const NonNegativeIntSchema = z.number().int().nonnegative().finite();
const SeqSchema = NonNegativeIntSchema;
const NonEmptyTrimmedStringSchema = z.string().refine((value) => value.trim().length > 0, "String must not be empty");

export const CategorySchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  name: NonEmptyTrimmedStringSchema,
  parentId: z.string().min(1).nullable(),
  color: HexColorSchema,
  icon: z.string().min(1).nullable(),
  sortOrder: z.number().int().finite(),
  isArchived: z.boolean(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});

export const SettingSchema = z.object({
  key: NonEmptyTrimmedStringSchema,
  value: z.string(),
  updatedAt: UtcIsoStringSchema,
});

export const QuickNoteSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  text: NonEmptyTrimmedStringSchema,
  occurredAt: UtcIsoStringSchema,
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});

export const TimeEntrySchema = z
  .object({
    id: NonEmptyTrimmedStringSchema,
    categoryId: NonEmptyTrimmedStringSchema,
    startTime: UtcIsoStringSchema,
    endTime: UtcIsoStringSchema,
    note: z.string().nullable(),
    createdAt: UtcIsoStringSchema,
    updatedAt: UtcIsoStringSchema,
  })
  .refine((entry) => entry.endTime > entry.startTime, {
    path: ["endTime"],
    message: "endTime must be after startTime",
  });

export const SyncLogEntrySchema = z.object({
  id: z.string(),
  tableName: z.enum(["categories", "time_entries", "settings", "quick_notes"]),
  recordId: z.string(),
  action: z.enum(["create", "update", "delete"]),
  timestamp: UtcIsoStringSchema,
  synced: z.union([z.literal(0), z.literal(1)]),
});

const BaseChangeFields = z.object({
  recordId: z.string().min(1),
  timestamp: UtcIsoStringSchema,
});

const CategoryUpsertChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("categories"),
  action: z.enum(["create", "update"]),
  data: CategorySchema,
});

const CategoryDeleteChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("categories"),
  action: z.literal("delete"),
  data: z.null(),
});

const TimeEntryUpsertChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("time_entries"),
  action: z.enum(["create", "update"]),
  data: TimeEntrySchema,
});

const TimeEntryDeleteChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("time_entries"),
  action: z.literal("delete"),
  data: z.null(),
});

const SettingUpsertChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("settings"),
  action: z.enum(["create", "update"]),
  data: SettingSchema,
});

const SettingDeleteChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("settings"),
  action: z.literal("delete"),
  data: z.null(),
});

const QuickNoteUpsertChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("quick_notes"),
  action: z.enum(["create", "update"]),
  data: QuickNoteSchema,
});

const QuickNoteDeleteChangeSchema = BaseChangeFields.extend({
  tableName: z.literal("quick_notes"),
  action: z.literal("delete"),
  data: z.null(),
});

export const SyncChangeSchema = z.union([
  CategoryUpsertChangeSchema,
  CategoryDeleteChangeSchema,
  TimeEntryUpsertChangeSchema,
  TimeEntryDeleteChangeSchema,
  SettingUpsertChangeSchema,
  SettingDeleteChangeSchema,
  QuickNoteUpsertChangeSchema,
  QuickNoteDeleteChangeSchema,
]);

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

export const SyncPullRequestSchema = z.object({
  lastSyncedAt: UtcIsoStringSchema.nullable().optional(),
  since: UtcIsoStringSchema.optional(),
  sinceSeq: SeqSchema.nullable().optional(),
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
