import { TaskSchema, type Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import type { TodoBuckets } from "../tasks.js";
import { buildTodoOverview } from "./overview.js";

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

const NOW = new Date("2026-07-28T04:00:00.000Z"); // Asia/Shanghai 2026-07-28 12:00
const DAILY = { freq: "daily", interval: 1, basis: "due" } as const;

function emptyBuckets(overrides: Partial<TodoBuckets> = {}): TodoBuckets {
  return {
    today: [],
    inbox: [],
    scheduled: [],
    scheduledSunkenFromIndex: 0,
    recurring: [],
    completed: [],
    atHand: [],
    handSession: null,
    projects: [],
    goalLinkedIds: new Set(),
    ...overrides,
  };
}

describe("buildTodoOverview", () => {
  it("空 buckets 全 0", () => {
    const result = buildTodoOverview(emptyBuckets(), [], NOW);
    expect(result).toEqual({
      total: 0,
      open: 0,
      doneTotal: 0,
      byBucket: { today: 0, inbox: 0, scheduled: 0, projects: 0 },
      recurringRules: 0,
      overdue: 0,
      noSchedule: 0,
    });
  });

  it("各桶计数与项目区任务数、noSchedule=inbox 条数", () => {
    const todayTask = makeTask({ id: "t1" });
    const inboxTask1 = makeTask({ id: "i1" });
    const inboxTask2 = makeTask({ id: "i2" });
    const scheduledTask = makeTask({ id: "s1", scheduledAt: "2026-08-01T00:00:00.000Z" });
    const projectTask = makeTask({ id: "p1" });
    const buckets = emptyBuckets({
      today: [todayTask],
      inbox: [inboxTask1, inboxTask2],
      scheduled: [scheduledTask],
      projects: [
        {
          goalId: "g1",
          goalTitle: "项目A",
          kind: "project",
          tasks: [projectTask],
        } as unknown as TodoBuckets["projects"][number],
      ],
    });
    const result = buildTodoOverview(buckets, [todayTask, inboxTask1, inboxTask2, scheduledTask, projectTask], NOW);
    expect(result.byBucket).toEqual({ today: 1, inbox: 2, scheduled: 1, projects: 1 });
    expect(result.noSchedule).toBe(2);
    expect(result.total).toBe(5);
  });

  it("doneTotal 数完成任务(含耗尽重复), open = total - doneTotal", () => {
    const done1 = makeTask({ id: "d1", done: true, completedAt: "2026-07-27T00:00:00.000Z" });
    const openTask = makeTask({ id: "o1" });
    const buckets = emptyBuckets({ completed: [done1], today: [openTask] });
    const result = buildTodoOverview(buckets, [done1, openTask], NOW);
    expect(result.doneTotal).toBe(1);
    expect(result.total).toBe(2);
    expect(result.open).toBe(1);
  });

  it("recurringRules 数未耗尽重复模板行(recurrence!==null 的根行)", () => {
    const rule = makeTask({ id: "r1", recurrence: DAILY, startAt: "2026-07-01T00:00:00.000Z" });
    const buckets = emptyBuckets({ scheduled: [rule] });
    const result = buildTodoOverview(buckets, [rule], NOW);
    expect(result.recurringRules).toBe(1);
  });

  it("overdue 复用 placementForTask 的 overdue 判定(today 桶里过期的 occurrence)", () => {
    const overdueTask = makeTask({ id: "od1", ruleId: "rule1", scheduledAt: "2026-07-20T00:00:00.000Z" });
    const notOverdue = makeTask({ id: "od2" });
    const buckets = emptyBuckets({ today: [overdueTask, notOverdue] });
    const result = buildTodoOverview(buckets, [overdueTask, notOverdue], NOW);
    expect(result.overdue).toBe(1);
  });
});
