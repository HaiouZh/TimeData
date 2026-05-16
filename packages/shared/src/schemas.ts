import { z } from "zod";

export const CategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().nullable(),
  color: z.string().min(1),
  icon: z.string().nullable(),
  sortOrder: z.number(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TimeEntrySchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SyncLogEntrySchema = z.object({
  id: z.string(),
  tableName: z.enum(["categories", "time_entries"]),
  recordId: z.string(),
  action: z.enum(["create", "update", "delete"]),
  timestamp: z.string(),
  synced: z.union([z.boolean(), z.literal(0), z.literal(1)]),
});

const BaseChangeFields = z.object({
  recordId: z.string().min(1),
  timestamp: z.string(),
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

export const SyncChangeSchema = z.union([
  CategoryUpsertChangeSchema,
  CategoryDeleteChangeSchema,
  TimeEntryUpsertChangeSchema,
  TimeEntryDeleteChangeSchema,
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
  baseSeq: z.number().nullable().optional(),
});

export const SyncPullResponseSchema = z.object({
  changes: z.array(SyncChangeSchema),
  serverTime: z.string(),
  latestSeq: z.number().nullable().optional(),
});
