import { z } from "zod";

export const UtcIsoStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }, "Invalid UTC ISO timestamp");

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const NonNegativeIntSchema = z.number().int().nonnegative().finite();
export const NonEmptyTrimmedStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "String must not be empty");

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
  source: z.enum(["user", "agent"]).optional(),
  sourceLabel: z.string().max(64).optional(),
  pinned: z.boolean().optional(),
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
