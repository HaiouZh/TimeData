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
    interval: z.number().int().positive().max(999),
    byWeekday: z.array(z.number().int().min(1).max(7)).min(1).optional(), // ISO 8601 weekday: 1=Mon … 7=Sun
    byMonthday: z
      .array(z.number().int().refine((n) => n === -1 || (n >= 1 && n <= 31), "monthday must be 1..31 or -1"))
      .min(1)
      .optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm").optional(),
    basis: z.enum(["due", "completion"]),
    count: z.number().int().min(1).max(999).optional(),
    until: UtcIsoStringSchema.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.freq === "weekly" && !r.byWeekday) ctx.addIssue({ code: "custom", message: "weekly requires byWeekday" });
    if (r.freq === "monthly" && !r.byMonthday) ctx.addIssue({ code: "custom", message: "monthly requires byMonthday" });
    if (r.freq === "daily" && (r.byWeekday || r.byMonthday))
      ctx.addIssue({ code: "custom", message: "daily must not set byWeekday/byMonthday" });
    if (r.freq === "weekly" && r.byMonthday) ctx.addIssue({ code: "custom", message: "weekly must not set byMonthday" });
    if (r.freq === "monthly" && r.byWeekday) ctx.addIssue({ code: "custom", message: "monthly must not set byWeekday" });
    if (r.count !== undefined && r.until !== undefined)
      ctx.addIssue({ code: "custom", message: "count and until are mutually exclusive" });
  });

export const GoalMemberRefSchema = z.object({
  kind: z.enum(["task", "track"]),
  id: NonEmptyTrimmedStringSchema,
});

export const GoalPrerequisiteSchema = z.object({
  blocker: GoalMemberRefSchema,
  blocked: GoalMemberRefSchema,
});

export const GoalLayoutPinNodeKindSchema = z.enum(["goal", "task", "track"]);

export const GoalLayoutPinSchema = z.object({
  goalId: NonEmptyTrimmedStringSchema,
  nodeKind: GoalLayoutPinNodeKindSchema,
  nodeId: NonEmptyTrimmedStringSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  updatedAt: UtcIsoStringSchema,
});

function goalMemberKey(ref: z.infer<typeof GoalMemberRefSchema>): string {
  return `${ref.kind}:${ref.id}`;
}

function hasPrerequisiteCycle(edges: Array<{ blocker: string; blocked: string }>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.blocker, [...(adjacency.get(edge.blocker) ?? []), edge.blocked]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;

    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  return [...adjacency.keys()].some(visit);
}

export const GoalSchema = z
  .object({
    id: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    kind: z.enum(["project", "theme"]),
    status: z.enum(["active", "archived"]).default("active"),
    note: z.string().optional(),
    members: z.array(GoalMemberRefSchema).max(500).default([]),
    prerequisites: z.array(GoalPrerequisiteSchema).max(100).default([]),
    createdAt: UtcIsoStringSchema,
    updatedAt: UtcIsoStringSchema,
  })
  .superRefine((goal, ctx) => {
    const memberKeys = new Set<string>();
    for (const member of goal.members) {
      const key = goalMemberKey(member);
      if (memberKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["members"],
          message: "goal member must be unique",
        });
      }
      memberKeys.add(key);
    }

    const seenEdges = new Set<string>();
    const edges: Array<{ blocker: string; blocked: string }> = [];
    for (const edge of goal.prerequisites) {
      const blocker = goalMemberKey(edge.blocker);
      const blocked = goalMemberKey(edge.blocked);

      if (!memberKeys.has(blocker) || !memberKeys.has(blocked)) {
        ctx.addIssue({
          code: "custom",
          path: ["prerequisites"],
          message: "goal prerequisite must reference members",
        });
      }

      if (blocker === blocked) {
        ctx.addIssue({
          code: "custom",
          path: ["prerequisites"],
          message: "goal prerequisite cannot reference itself",
        });
      }

      const key = `${blocker}->${blocked}`;
      if (seenEdges.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["prerequisites"],
          message: "goal prerequisite edge must be unique",
        });
      }
      seenEdges.add(key);
      edges.push({ blocker, blocked });
    }

    if (hasPrerequisiteCycle(edges)) {
      ctx.addIssue({
        code: "custom",
        path: ["prerequisites"],
        message: "goal prerequisites must be acyclic",
      });
    }
  });

export const TaskSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  parentId: z.string().min(1).nullable().default(null),
  title: NonEmptyTrimmedStringSchema,
  done: z.boolean(),
  recurrence: RecurrenceSchema.nullable(),
  lastDoneAt: UtcIsoStringSchema.nullable(),
  startAt: UtcIsoStringSchema.nullable(),
  scheduledAt: UtcIsoStringSchema.nullable(),
  completedCount: z.number().int().min(0).default(0),
  weight: z.number().int().min(0).default(0),
  completedAt: UtcIsoStringSchema.nullable().default(null),
  tags: z
    .array(NonEmptyTrimmedStringSchema.refine((value) => value.length <= 64, "tag must be at most 64 characters"))
    .max(50)
    .default([]),
  ruleId: z.string().min(1).nullable().default(null),
  skipped: z.boolean().default(false),
  sortOrder: z.number().int().finite(),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});

export const RefSchema = z.object({
  kind: NonEmptyTrimmedStringSchema,
  id: NonEmptyTrimmedStringSchema,
  label: z.string().max(200).optional(),
});

export const TrackSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  title: NonEmptyTrimmedStringSchema,
  summary: z.string().optional(),
  status: z.enum(["active", "concluded", "parked"]),
  refs: z.array(RefSchema).max(100).default([]),
  createdAt: UtcIsoStringSchema,
  updatedAt: UtcIsoStringSchema,
});

export const TrackStepSchema = z
  .object({
    id: NonEmptyTrimmedStringSchema,
    trackId: NonEmptyTrimmedStringSchema,
    source: z.enum(["user", "agent"]),
    sourceLabel: z.string().max(64).optional(),
    content: z.string(),
    startedAt: UtcIsoStringSchema,
    endedAt: UtcIsoStringSchema.nullable(),
    refs: z.array(RefSchema).max(100).default([]),
    tags: z
      .array(NonEmptyTrimmedStringSchema.refine((value) => value.length <= 64, "tag must be at most 64 characters"))
      .max(50)
      .default([]),
    seq: NonNegativeIntSchema,
    createdAt: UtcIsoStringSchema,
    updatedAt: UtcIsoStringSchema,
  })
  .refine((step) => step.endedAt === null || step.endedAt >= step.startedAt, {
    path: ["endedAt"],
    message: "endedAt must be at or after startedAt",
  });
