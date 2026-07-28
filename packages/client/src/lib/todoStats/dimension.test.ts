import { GoalSchema, TaskSchema, type Goal, type Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { projectBreakdown, tagBreakdown } from "./dimension.js";

let taskSeq = 0;
function makeTask(overrides: Partial<Task> & { id: string }): Task {
  taskSeq += 1;
  return TaskSchema.parse({
    parentId: null,
    title: `任务${taskSeq}`,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: taskSeq,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  });
}

let goalSeq = 0;
function makeGoal(overrides: Partial<Goal> & { id: string }): Goal {
  goalSeq += 1;
  return GoalSchema.parse({
    title: `目标${goalSeq}`,
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  });
}

describe("tagBreakdown", () => {
  it("一任务多标签各计一次", () => {
    const tasks = [
      makeTask({ id: "t1", tags: ["a", "b"], done: false }),
      makeTask({ id: "t2", tags: ["a"], done: true }),
    ];
    const result = tagBreakdown(tasks);
    const a = result.find((r) => r.tag === "a");
    const b = result.find((r) => r.tag === "b");
    expect(a).toEqual({ tag: "a", open: 1, done: 1 });
    expect(b).toEqual({ tag: "b", open: 1, done: 0 });
  });

  it("未打标签归桶「未打标签」", () => {
    const tasks = [makeTask({ id: "t1", tags: [], done: false })];
    const result = tagBreakdown(tasks);
    expect(result).toEqual([{ tag: "未打标签", open: 1, done: 0 }]);
  });

  it("按 open+done 降序，取前 10", () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 12; i += 1) {
      const tagCount = 12 - i; // tag0 has most occurrences
      for (let j = 0; j < tagCount; j += 1) {
        tasks.push(makeTask({ id: `t${i}-${j}`, tags: [`tag${i}`], done: false }));
      }
    }
    const result = tagBreakdown(tasks);
    expect(result.length).toBe(10);
    expect(result[0].tag).toBe("tag0");
    expect(result[0].open).toBe(12);
    // strictly descending
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1].open + result[i - 1].done).toBeGreaterThanOrEqual(result[i].open + result[i].done);
    }
  });
});

describe("projectBreakdown", () => {
  it("只认 kind==='project' 的 goal，非 project goal 不出现", () => {
    const projectGoal = makeGoal({
      id: "g1",
      kind: "project",
      title: "项目一",
      members: [{ kind: "task", id: "t1" }],
    });
    const themeGoal = makeGoal({
      id: "g2",
      kind: "theme",
      title: "主题一",
      members: [{ kind: "task", id: "t2" }],
    });
    const tasks = [
      makeTask({ id: "t1", done: false }),
      makeTask({ id: "t2", done: false }),
    ];
    const result = projectBreakdown(tasks, [projectGoal, themeGoal]);
    expect(result).toEqual([{ goalId: "g1", title: "项目一", open: 1, done: 0 }]);
    expect(result.find((r) => r.goalId === "g2")).toBeUndefined();
  });

  it("统计 open/done 计数", () => {
    const projectGoal = makeGoal({
      id: "g1",
      kind: "project",
      title: "项目一",
      members: [
        { kind: "task", id: "t1" },
        { kind: "task", id: "t2" },
        { kind: "task", id: "t3" },
      ],
    });
    const tasks = [
      makeTask({ id: "t1", done: false }),
      makeTask({ id: "t2", done: true }),
      makeTask({ id: "t3", done: true }),
    ];
    const result = projectBreakdown(tasks, [projectGoal]);
    expect(result).toEqual([{ goalId: "g1", title: "项目一", open: 1, done: 2 }]);
  });

  it("archived project goal 不出现", () => {
    const archivedGoal = makeGoal({
      id: "g1",
      kind: "project",
      status: "archived",
      title: "已归档",
      members: [{ kind: "task", id: "t1" }],
    });
    const tasks = [makeTask({ id: "t1", done: false })];
    const result = projectBreakdown(tasks, [archivedGoal]);
    expect(result).toEqual([]);
  });
});
