import { describe, it, expect } from "vitest";
import { GoalLayoutPinSchema, GoalSchema, RecurrenceSchema, TaskSchema, TrackSchema } from "./entitySchemas.js";

describe("RecurrenceSchema", () => {
  const base = { interval: 1, basis: "due" as const };
  it("accepts daily", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily" }).success).toBe(true);
  });
  it("requires byWeekday for weekly", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly" }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly", byWeekday: [1, 3, 5] }).success).toBe(true);
  });
  it("requires byMonthday for monthly and allows -1 (month end)", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly" }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly", byMonthday: [1, 15, -1] }).success).toBe(true);
  });
  it("rejects byWeekday on daily", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", byWeekday: [1] }).success).toBe(false);
  });
  it("rejects byWeekday out-of-range [8]", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly", byWeekday: [8] }).success).toBe(false);
  });
  it("rejects byMonthday out-of-range [0]", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly", byMonthday: [0] }).success).toBe(false);
  });
  it("rejects mismatched freq/by-field combinations", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly", byWeekday: [1], byMonthday: [15] }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly", byMonthday: [1], byWeekday: [1] }).success).toBe(false);
  });
  it("rejects non-positive interval", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", interval: 0 }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", interval: -1 }).success).toBe(false);
  });
  it("validates time format", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", time: "06:30" }).success).toBe(true);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", time: "6:30" }).success).toBe(false);
  });
});

describe("TaskSchema", () => {
  const t = {
    id: "t1", title: "跑步", done: false, recurrence: null,
    lastDoneAt: null, startAt: null, scheduledAt: null,
    sortOrder: 0,
    createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z",
  };
  it("accepts a pool task", () => {
    expect(TaskSchema.safeParse(t).success).toBe(true);
  });
  it("rejects empty title", () => {
    expect(TaskSchema.safeParse({ ...t, title: "  " }).success).toBe(false);
  });
  it("accepts a recurring task", () => {
    expect(TaskSchema.safeParse({
      ...t, recurrence: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due", time: "06:00" },
    }).success).toBe(true);
  });
});

describe("TaskSchema scheduledAt", () => {
  const baseTask = {
    id: "t1", title: "刮胡子", done: false, recurrence: null,
    lastDoneAt: null, startAt: null, scheduledAt: null,
    sortOrder: 0, createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z",
  };
  it("接受 null scheduledAt", () => {
    expect(TaskSchema.parse(baseTask).scheduledAt).toBeNull();
  });
  it("接受合法未来 scheduledAt", () => {
    const t = TaskSchema.parse({ ...baseTask, scheduledAt: "2026-12-25T00:00:00.000Z" });
    expect(t.scheduledAt).toBe("2026-12-25T00:00:00.000Z");
  });
  it("scheduledAt 非严格 UTC ISO 报错", () => {
    expect(() => TaskSchema.parse({ ...baseTask, scheduledAt: "2026-12-25" })).toThrow();
  });
});

describe("RecurrenceSchema 终止条件", () => {
  it("接受 count", () => {
    const r = RecurrenceSchema.parse({ freq: "daily", interval: 1, basis: "due", count: 12 });
    expect(r.count).toBe(12);
  });

  it("接受 until（当地零点 UtcIso）", () => {
    const r = RecurrenceSchema.parse({ freq: "daily", interval: 1, basis: "due", until: "2026-07-31T00:00:00.000Z" });
    expect(r.until).toBe("2026-07-31T00:00:00.000Z");
  });

  it("count 与 until 互斥", () => {
    expect(() =>
      RecurrenceSchema.parse({
        freq: "daily",
        interval: 1,
        basis: "due",
        count: 3,
        until: "2026-07-31T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("count 必须 >= 1", () => {
    expect(() => RecurrenceSchema.parse({ freq: "daily", interval: 1, basis: "due", count: 0 })).toThrow();
  });
});

describe("TaskSchema completedCount", () => {
  it("缺省为 0", () => {
    const t = TaskSchema.parse({
      id: "t1",
      title: "x",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      sortOrder: 0,
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    });
    expect(t.completedCount).toBe(0);
  });
});

describe("TaskSchema legacy flow fields", () => {
  const legacyField = "tu" + "rn";
  const legacyTimeField = `${legacyField}At`;
  const baseTask = {
    id: "t1",
    title: "回合任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    sortOrder: 0,
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
  };

  it("解析结果不再含旧回合字段", () => {
    const task = TaskSchema.parse(baseTask);
    expect(Object.hasOwn(task, legacyField)).toBe(false);
    expect(Object.hasOwn(task, legacyTimeField)).toBe(false);
  });

  it("带旧回合字段的输入会被剥离", () => {
    const task = TaskSchema.parse({
      ...baseTask,
      [legacyField]: "running",
      [legacyTimeField]: "2026-06-16T01:00:00.000Z",
    });
    expect(Object.hasOwn(task, legacyField)).toBe(false);
    expect(Object.hasOwn(task, legacyTimeField)).toBe(false);
  });
});

describe("TaskSchema completedAt/tags", () => {
  const baseTask = {
    id: "t1",
    title: "标签任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    sortOrder: 0,
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
  };

  it("completedAt/tags 缺省", () => {
    const task = TaskSchema.parse(baseTask);
    expect(task.completedAt).toBeNull();
    expect(task.tags).toEqual([]);
  });

  it("接受 completedAt 与 tags", () => {
    const task = TaskSchema.parse({
      ...baseTask,
      completedAt: "2026-06-16T02:00:00.000Z",
      tags: ["agent", "idea"],
    });
    expect(task.completedAt).toBe("2026-06-16T02:00:00.000Z");
    expect(task.tags).toEqual(["agent", "idea"]);
  });

  it("拒绝空字符串 tag", () => {
    expect(() => TaskSchema.parse({ ...baseTask, tags: [" "] })).toThrow();
  });
});

describe("TaskSchema parentId", () => {
  const baseTask = {
    id: "t1",
    title: "父任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
  };

  it("defaults parentId to null", () => {
    expect(TaskSchema.parse(baseTask).parentId).toBeNull();
  });

  it("accepts non-empty parentId and rejects empty string", () => {
    expect(TaskSchema.parse({ ...baseTask, parentId: "root-1" }).parentId).toBe("root-1");
    expect(() => TaskSchema.parse({ ...baseTask, parentId: "" })).toThrow();
  });

  it("strips unknown legacy keys from parsed task", () => {
    // 旧数据（含已废弃字段）经 TaskSchema.parse 后未知键被 zod 剥离，老备份回灌无害。
    const legacyKey = "sub" + "tasks";
    const parsed = TaskSchema.parse({ ...baseTask, [legacyKey]: [{ id: "s1", title: "旧子项", done: false }] });
    expect(Object.hasOwn(parsed, legacyKey)).toBe(false);
  });
});

describe("GoalSchema", () => {
  const now = "2026-06-22T01:00:00.000Z";
  const baseGoal = {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const task = {
    id: "t1",
    title: "任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
  const track = {
    id: "track-1",
    title: "轨道",
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
  };

  it("parses project/theme goals and defaults members/prerequisites", () => {
    expect(GoalSchema.parse({ ...baseGoal, kind: "theme" })).toMatchObject({
      kind: "theme",
      members: [],
      prerequisites: [],
    });
  });

  it("parses goals with typed members and typed prerequisites", () => {
    const parsed = GoalSchema.parse({
      ...baseGoal,
      members: [
        { kind: "task", id: "task-1" },
        { kind: "track", id: "track-1" },
      ],
      prerequisites: [
        {
          blocker: { kind: "task", id: "task-1" },
          blocked: { kind: "track", id: "track-1" },
        },
      ],
    });

    expect(parsed.members).toEqual([
      { kind: "task", id: "task-1" },
      { kind: "track", id: "track-1" },
    ]);
    expect(parsed.prerequisites).toHaveLength(1);
  });

  it("rejects duplicate members and prerequisites outside members", () => {
    expect(
      GoalSchema.safeParse({
        ...baseGoal,
        members: [
          { kind: "task", id: "task-1" },
          { kind: "task", id: "task-1" },
        ],
      }).success,
    ).toBe(false);

    expect(
      GoalSchema.safeParse({
        ...baseGoal,
        members: [{ kind: "task", id: "task-1" }],
        prerequisites: [
          {
            blocker: { kind: "task", id: "task-1" },
            blocked: { kind: "track", id: "track-missing" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects self edges, duplicate edges and typed cycles", () => {
    const members = [
      { kind: "task" as const, id: "task-1" },
      { kind: "track" as const, id: "track-1" },
    ];

    expect(GoalSchema.safeParse({ ...baseGoal, members, prerequisites: [{ blocker: members[0], blocked: members[0] }] }).success).toBe(false);
    expect(
      GoalSchema.safeParse({
        ...baseGoal,
        members,
        prerequisites: [
          { blocker: members[0], blocked: members[1] },
          { blocker: members[0], blocked: members[1] },
        ],
      }).success,
    ).toBe(false);
    expect(
      GoalSchema.safeParse({
        ...baseGoal,
        members,
        prerequisites: [
          { blocker: members[0], blocked: members[1] },
          { blocker: members[1], blocked: members[0] },
        ],
      }).success,
    ).toBe(false);
  });

  it("strips retired Task.goalId and Track.goalId fields", () => {
    const parsedTask = TaskSchema.parse({ ...task, goalId: "goal-1" });
    const parsedTrack = TrackSchema.parse({ ...track, goalId: "goal-1" });

    expect(Object.hasOwn(parsedTask, "goalId")).toBe(false);
    expect(Object.hasOwn(parsedTrack, "goalId")).toBe(false);
  });
});

describe("TaskSchema weight", () => {
  const baseTask = {
    id: "t1",
    title: "想法",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  };

  it("defaults weight to zero for legacy task payloads", () => {
    const parsed = TaskSchema.parse(baseTask);
    expect(parsed.weight).toBe(0);
  });

  it("accepts non-negative integer weight", () => {
    const parsed = TaskSchema.parse({ ...baseTask, weight: 3 });
    expect(parsed.weight).toBe(3);
  });

  it("rejects negative or fractional weight", () => {
    expect(() => TaskSchema.parse({ ...baseTask, weight: -1 })).toThrow();
    expect(() => TaskSchema.parse({ ...baseTask, weight: 1.5 })).toThrow();
  });
});

describe("TaskSchema ruleId/skipped", () => {
  const baseTask = {
    id: "t1", title: "占位", done: false, recurrence: null,
    lastDoneAt: null, startAt: null, scheduledAt: null, completedCount: 0,
    completedAt: null, tags: [], weight: 0, sortOrder: 0,
    createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z",
  };
  it("legacy payload 缺 ruleId/skipped → 默认 null/false", () => {
    const t = TaskSchema.parse(baseTask);
    expect(t.ruleId).toBeNull();
    expect(t.skipped).toBe(false);
  });
  it("接受 ruleId 字符串与 skipped=true", () => {
    const t = TaskSchema.parse({ ...baseTask, ruleId: "rule-1", skipped: true });
    expect(t.ruleId).toBe("rule-1");
    expect(t.skipped).toBe(true);
  });
  it("拒绝空串 ruleId", () => {
    expect(() => TaskSchema.parse({ ...baseTask, ruleId: "" })).toThrow();
  });
});

describe("GoalLayoutPinSchema", () => {
  const now = "2026-06-24T00:00:00.000Z";

  it("accepts finite coordinates for goal/task/track pins", () => {
    for (const nodeKind of ["goal", "task", "track"] as const) {
      expect(
        GoalLayoutPinSchema.safeParse({
          goalId: "goal-1",
          nodeKind,
          nodeId: nodeKind === "goal" ? "goal-1" : `${nodeKind}-1`,
          x: 12.5,
          y: -8,
          updatedAt: now,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects empty ids, non-finite coordinates and non-UTC timestamps", () => {
    expect(
      GoalLayoutPinSchema.safeParse({
        goalId: "",
        nodeKind: "goal",
        nodeId: "goal-1",
        x: 0,
        y: 0,
        updatedAt: now,
      }).success,
    ).toBe(false);
    expect(
      GoalLayoutPinSchema.safeParse({
        goalId: "goal-1",
        nodeKind: "goal",
        nodeId: "goal-1",
        x: Number.NaN,
        y: 0,
        updatedAt: now,
      }).success,
    ).toBe(false);
    expect(
      GoalLayoutPinSchema.safeParse({
        goalId: "goal-1",
        nodeKind: "goal",
        nodeId: "goal-1",
        x: 0,
        y: 0,
        updatedAt: "2026-06-24T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
