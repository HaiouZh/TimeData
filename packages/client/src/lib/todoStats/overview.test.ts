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
    waiting: [],
    waitingBlockerTitles: {},
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

  it("各桶计数与项目区任务数、noSchedule 直数 scheduledAt===null 的未完成根任务", () => {
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
    // todayTask/inboxTask1/inboxTask2/projectTask 均无 scheduledAt(默认 null)，只有 scheduledTask 有排期
    expect(result.noSchedule).toBe(4);
    expect(result.total).toBe(5);
  });

  it("doneTotal 与 completionEvents 同源(排除耗尽重复模板行,不再是全量 done 计数)", () => {
    const done1 = makeTask({ id: "d1", done: true, completedAt: "2026-07-27T00:00:00.000Z" });
    const openTask = makeTask({ id: "o1" });
    // 耗尽的重复模板行：done=true 但 recurrence!==null，completionEvents 排除它
    const exhaustedTemplate = makeTask({
      id: "tpl1",
      recurrence: DAILY,
      done: true,
      completedAt: "2026-07-27T00:00:00.000Z",
      startAt: "2026-07-01T00:00:00.000Z",
    });
    const buckets = emptyBuckets({ completed: [done1], today: [openTask] });
    const result = buildTodoOverview(buckets, [done1, openTask, exhaustedTemplate], NOW);
    expect(result.doneTotal).toBe(1); // 只数 done1，不数耗尽模板行
    expect(result.total).toBe(3);
    expect(result.open).toBe(2);
  });

  it("recurringRules 按实现现状钉：不过滤 done，耗尽的重复模板行仍计入", () => {
    const rule = makeTask({ id: "r1", recurrence: DAILY, startAt: "2026-07-01T00:00:00.000Z" });
    const exhaustedRule = makeTask({
      id: "r2",
      recurrence: DAILY,
      done: true,
      completedAt: "2026-07-27T00:00:00.000Z",
      startAt: "2026-07-01T00:00:00.000Z",
    });
    const buckets = emptyBuckets({ scheduled: [rule] });
    const result = buildTodoOverview(buckets, [rule, exhaustedRule], NOW);
    expect(result.recurringRules).toBe(2);
  });

  it("overdue 复用 placementForTask 的 overdue 判定(today 桶里过期的 occurrence)", () => {
    const overdueTask = makeTask({ id: "od1", ruleId: "rule1", scheduledAt: "2026-07-20T00:00:00.000Z" });
    const notOverdue = makeTask({ id: "od2" });
    const buckets = emptyBuckets({ today: [overdueTask, notOverdue] });
    const result = buildTodoOverview(buckets, [overdueTask, notOverdue], NOW);
    expect(result.overdue).toBe(1);
  });

  it("overdue 补计一次性过期任务(排期已过、未完成、回流 inbox、不带 overdue 标志)", () => {
    // NOW = 2026-07-28T04:00:00.000Z (Asia/Shanghai 2026-07-28 12:00)，一次性任务排期已过落 inbox
    const oneOffExpired = makeTask({ id: "oo1", scheduledAt: "2026-07-20T00:00:00.000Z" });
    const notExpired = makeTask({ id: "oo2", scheduledAt: "2026-08-01T00:00:00.000Z" });
    const buckets = emptyBuckets({ inbox: [oneOffExpired, notExpired] });
    const result = buildTodoOverview(buckets, [oneOffExpired, notExpired], NOW);
    expect(result.overdue).toBe(1);
  });

  it("noSchedule 直数 scheduledAt===null 的未完成根任务，不再等同 inbox.length", () => {
    // inbox 桶混了过期一次性任务(有 scheduledAt)——旧口径 noSchedule=inbox.length 会把它也算进"无排期"
    const noSchedTask = makeTask({ id: "ns1" });
    const oneOffExpired = makeTask({ id: "oo1", scheduledAt: "2026-07-20T00:00:00.000Z" });
    const buckets = emptyBuckets({ inbox: [noSchedTask, oneOffExpired] });
    const result = buildTodoOverview(buckets, [noSchedTask, oneOffExpired], NOW);
    expect(result.noSchedule).toBe(1);
  });
});
