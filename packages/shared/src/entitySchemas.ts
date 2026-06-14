import { z } from "zod";

export const UtcIsoStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "must be UTC ISO timestamp format (ending with .sssZ)")
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

export const RecurrenceSchema = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().positive(),
    byWeekday: z.array(z.number().int().min(1).max(7)).min(1).optional(),
    byMonthday: z
      .array(z.number().int().refine((n) => n === -1 || (n >= 1 && n <= 31), "monthday must be 1..31 or -1"))
      .min(1)
      .optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm").optional(),
    basis: z.enum(["due", "completion"]),
  })
  .superRefine((r, ctx) => {
    if (r.freq === "weekly" && !r.byWeekday) ctx.addIssue({ code: "custom", message: "weekly requires byWeekday" });
    if (r.freq === "monthly" && !r.byMonthday) ctx.addIssue({ code: "custom", message: "monthly requires byMonthday" });
    if (r.freq === "daily" && (r.byWeekday || r.byMonthday))
      ctx.addIssue({ code: "custom", message: "daily must not set byWeekday/byMonthday" });
  });

export const TaskSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  title: NonEmptyTrimmedStringSchema,
  done: z.boolean(),
  recurrence: RecurrenceSchema.nullable(),
  lastDoneAt: UtcIsoStringSchema.nullable(),
  startAt: UtcIsoStringSchema.nullable(),
  sortOrder: z.number().int().finite(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});
