import { TaskSchema, type Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { completionEvents, countByDay, countByWeek, creationEvents } from "./events.js";

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

const T1 = "2026-07-24T00:00:00.000Z";
const DAILY = { freq: "daily", interval: 1, basis: "due" } as const;

describe("completionEvents", () => {
  it("重复模板行有 completedAt(耗尽)也不算完成事件", () => {
    const template = makeTask({ id: "tpl", recurrence: DAILY, completedAt: T1 });
    const occurrence = makeTask({ id: "occ", ruleId: template.id, done: true, completedAt: T1 });
    expect(completionEvents([template, occurrence])).toHaveLength(1);
  });

  it("普通任务 completedAt≠null 算完成事件", () => {
    const task = makeTask({ id: "t1", done: true, completedAt: T1 });
    expect(completionEvents([task])).toHaveLength(1);
  });

  it("completedAt===null 不算完成事件", () => {
    const task = makeTask({ id: "t1" });
    expect(completionEvents([task])).toHaveLength(0);
  });
});

describe("creationEvents", () => {
  it("occurrence 行不算创建事件", () => {
    expect(creationEvents([makeTask({ id: "occ", ruleId: "r1" })])).toHaveLength(0);
  });

  it("ruleId===null 的行算创建事件", () => {
    expect(creationEvents([makeTask({ id: "t1" })])).toHaveLength(1);
  });

  it("occurrence 子任务克隆行(id 形如 occId:child:templateChildId)不算创建事件——反证", () => {
    const clone = makeTask({ id: "occ1:child:tplchild1" });
    expect(creationEvents([clone])).toHaveLength(0);
  });

  it("普通任务 id 不含 :child: 分隔符时仍正常计入创建事件", () => {
    const task = makeTask({ id: "normal-task-id" });
    expect(creationEvents([task])).toHaveLength(1);
  });
});

describe("countByDay", () => {
  it("countByDay 用 APP_TIME_ZONE 日界,不用 UTC 切割", () => {
    // UTC 2026-07-24T23:00:00Z -> Asia/Shanghai (UTC+8) 2026-07-25T07:00:00，跨了 UTC 日界
    const iso = "2026-07-24T23:00:00.000Z";
    const map = countByDay([iso]);
    expect(map.get("2026-07-25")).toBe(1);
    expect(map.has("2026-07-24")).toBe(false);
  });

  it("统计多条同日时间戳", () => {
    const map = countByDay(["2026-07-24T01:00:00.000Z", "2026-07-24T02:00:00.000Z"]);
    expect(map.get("2026-07-24")).toBe(2);
  });
});

describe("countByWeek", () => {
  it("按周一日期分桶", () => {
    // 2026-07-24 是周五（本地日），所在周的周一是 2026-07-20
    const map = countByWeek(["2026-07-24T01:00:00.000Z"]);
    expect(map.get("2026-07-20")).toBe(1);
  });
});
