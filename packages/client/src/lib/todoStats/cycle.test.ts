import { TaskSchema, type Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { cycleMetrics } from "./cycle.js";

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

const TODAY = "2026-07-28";
const DAILY = { freq: "daily", interval: 1, basis: "due" } as const;

describe("cycleMetrics 周转（medianTurnaroundDays / turnaroundBuckets）", () => {
  it("occurrence 行(ruleId≠null)排除在周转统计外——反证：只有 occurrence 完成时中位数为 null", () => {
    const template = makeTask({ id: "tpl", recurrence: DAILY });
    const occ = makeTask({
      id: "occ",
      ruleId: template.id,
      done: true,
      createdAt: "2026-07-20T00:00:00.000Z",
      completedAt: "2026-07-27T00:00:00.000Z",
    });
    const result = cycleMetrics([template, occ], TODAY);
    expect(result.medianTurnaroundDays).toBeNull();
    expect(result.turnaroundBuckets.reduce((sum, b) => sum + b.count, 0)).toBe(0);
  });

  it("中位数——奇数个样本取中间值", () => {
    const tasks = [
      makeTask({ id: "a", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-02T00:00:00.000Z" }), // 1天
      makeTask({ id: "b", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-06T00:00:00.000Z" }), // 5天
      makeTask({ id: "c", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-21T00:00:00.000Z" }), // 20天
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.medianTurnaroundDays).toBe(5);
  });

  it("中位数——偶数个样本取中间两者平均", () => {
    const tasks = [
      makeTask({ id: "a", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-02T00:00:00.000Z" }), // 1天
      makeTask({ id: "b", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-06T00:00:00.000Z" }), // 5天
      makeTask({ id: "c", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-21T00:00:00.000Z" }), // 20天
      makeTask({ id: "d", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-31T00:00:00.000Z" }), // 30天
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.medianTurnaroundDays).toBe(12.5);
  });

  it("无完成事件时 medianTurnaroundDays 为 null", () => {
    const result = cycleMetrics([], TODAY);
    expect(result.medianTurnaroundDays).toBeNull();
  });

  it("分桶：当天/1-3天/4-7天/8-30天/>30天", () => {
    const tasks = [
      makeTask({ id: "a", createdAt: "2026-07-10T00:00:00.000Z", completedAt: "2026-07-10T05:00:00.000Z" }), // 当天
      makeTask({ id: "b", createdAt: "2026-07-10T00:00:00.000Z", completedAt: "2026-07-12T00:00:00.000Z" }), // 2天 -> 1-3
      makeTask({ id: "c", createdAt: "2026-07-10T00:00:00.000Z", completedAt: "2026-07-16T00:00:00.000Z" }), // 6天 -> 4-7
      makeTask({ id: "d", createdAt: "2026-07-10T00:00:00.000Z", completedAt: "2026-07-20T00:00:00.000Z" }), // 10天 -> 8-30
      makeTask({ id: "e", createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-08-15T00:00:00.000Z" }), // >30天
    ];
    const result = cycleMetrics(tasks, TODAY);
    const byLabel = Object.fromEntries(result.turnaroundBuckets.map((b) => [b.label, b.count]));
    expect(byLabel["当天"]).toBe(1);
    expect(byLabel["1-3天"]).toBe(1);
    expect(byLabel["4-7天"]).toBe(1);
    expect(byLabel["8-30天"]).toBe(1);
    expect(byLabel[">30天"]).toBe(1);
  });
});

describe("cycleMetrics avgCompletedPerDay", () => {
  it("完成事件总数 ÷ 首个完成事件至今天数", () => {
    const tasks = [
      makeTask({ id: "a", completedAt: "2026-07-24T00:00:00.000Z" }), // 首个完成日 07-24，距 today(07-28) 4天
      makeTask({ id: "b", completedAt: "2026-07-25T00:00:00.000Z" }),
      makeTask({ id: "c", completedAt: "2026-07-26T00:00:00.000Z" }),
      makeTask({ id: "d", completedAt: "2026-07-27T00:00:00.000Z" }),
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.avgCompletedPerDay).toBe(1);
  });

  it("无完成事件时 avgCompletedPerDay 为 0", () => {
    const result = cycleMetrics([], TODAY);
    expect(result.avgCompletedPerDay).toBe(0);
  });
});

describe("cycleMetrics streak（口径钉死：连续有≥1完成事件的本地日历天）", () => {
  it("今天已完成——currentStreak 从今天回数", () => {
    const tasks = [
      makeTask({ id: "a", completedAt: "2026-07-28T01:00:00.000Z" }), // 今天
      makeTask({ id: "b", completedAt: "2026-07-27T01:00:00.000Z" }), // 昨天
      makeTask({ id: "c", completedAt: "2026-07-26T01:00:00.000Z" }), // 前天
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.currentStreak).toBe(3);
  });

  it("今天还没完成，但昨天有——不打断昨天为止的连击（从昨天起算）", () => {
    const tasks = [
      makeTask({ id: "b", completedAt: "2026-07-27T01:00:00.000Z" }), // 昨天
      makeTask({ id: "c", completedAt: "2026-07-26T01:00:00.000Z" }), // 前天
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.currentStreak).toBe(2);
  });

  it("今天、昨天都没完成——currentStreak 为 0（即便更早有连续记录也不算）", () => {
    const tasks = [
      makeTask({ id: "x", completedAt: "2026-07-20T01:00:00.000Z" }),
      makeTask({ id: "y", completedAt: "2026-07-19T01:00:00.000Z" }),
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.currentStreak).toBe(0);
  });

  it("streak 中间断档会截断——昨天有、前天无，currentStreak 停在 1", () => {
    const tasks = [
      makeTask({ id: "b", completedAt: "2026-07-27T01:00:00.000Z" }), // 昨天
      makeTask({ id: "z", completedAt: "2026-07-20T01:00:00.000Z" }), // 更早，中间有断档
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.currentStreak).toBe(1);
  });

  it("longestStreak 取历史最长连续天数，可能大于 currentStreak", () => {
    const tasks = [
      // 历史最长连击：07-10,11,12,13（4天）
      makeTask({ id: "h1", completedAt: "2026-07-10T01:00:00.000Z" }),
      makeTask({ id: "h2", completedAt: "2026-07-11T01:00:00.000Z" }),
      makeTask({ id: "h3", completedAt: "2026-07-12T01:00:00.000Z" }),
      makeTask({ id: "h4", completedAt: "2026-07-13T01:00:00.000Z" }),
      // 当前连击：昨天(07-27)单天
      makeTask({ id: "b", completedAt: "2026-07-27T01:00:00.000Z" }),
    ];
    const result = cycleMetrics(tasks, TODAY);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(4);
  });

  it("无完成事件时 currentStreak/longestStreak 均为 0", () => {
    const result = cycleMetrics([], TODAY);
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(0);
  });

  it("重复模板行(recurrence≠null)完成不计入 streak（与 completionEvents 口径一致）", () => {
    const template = makeTask({ id: "tpl", recurrence: DAILY, completedAt: "2026-07-28T01:00:00.000Z" });
    const result = cycleMetrics([template], TODAY);
    expect(result.currentStreak).toBe(0);
  });
});
