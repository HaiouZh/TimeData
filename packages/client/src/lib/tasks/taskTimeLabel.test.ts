import type { Recurrence } from "@timedata/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recurrenceSummary } from "./recurrence.js";
import { taskDueDateLabel, taskTimeLabel } from "./taskTimeLabel.js";

describe("taskTimeLabel", () => {
  beforeEach(() => {
    // 固定「当前时间」为 2026-06-28，消除「今年」判定的时间敏感性
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("无重复无日期 -> 设定时间", () => {
    expect(taskTimeLabel({ recurrence: null, scheduledAt: null })).toBe("设定时间");
  });

  it("scheduledAt 当年 -> m月d日", () => {
    expect(taskTimeLabel({ recurrence: null, scheduledAt: "2026-06-20T00:00:00.000Z" })).toBe("6月20日");
  });

  it("scheduledAt 非当年（明年）-> yyyy年m月d日", () => {
    expect(taskTimeLabel({ recurrence: null, scheduledAt: "2027-06-20T00:00:00.000Z" })).toBe("2027年6月20日");
  });

  it("scheduledAt 非当年（去年）-> yyyy年m月d日", () => {
    expect(taskTimeLabel({ recurrence: null, scheduledAt: "2025-12-31T00:00:00.000Z" })).toBe("2025年12月31日");
  });

  it("重复 -> recurrence summary + 下一发生日", () => {
    const recurrence: Recurrence = { freq: "daily", interval: 1, basis: "due" };

    const label = taskTimeLabel({
      recurrence,
      scheduledAt: "2026-06-20T00:00:00.000Z",
      lastDoneAt: null,
      startAt: "2026-06-20T00:00:00.000Z",
    });

    expect(label).toBe(`${recurrenceSummary(recurrence)} · 6月20日`);
    expect(label).not.toBe("设定时间");
  });
});

describe("taskDueDateLabel", () => {
  it("重复任务只返回日期部分，不含重复摘要", () => {
    const label = taskDueDateLabel({
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      scheduledAt: null,
      lastDoneAt: null,
      startAt: "2099-12-31T00:00:00.000Z",
    });
    expect(label).toBe("2099年12月31日");
    expect(label).not.toContain("每天");
  });

  it("非重复已排期返回日期串", () => {
    expect(taskDueDateLabel({ recurrence: null, scheduledAt: "2026-06-20T00:00:00.000Z" })).toBe("6月20日");
  });

  it("非重复未排期返回设定时间", () => {
    expect(taskDueDateLabel({ recurrence: null, scheduledAt: null })).toBe("设定时间");
  });
});
