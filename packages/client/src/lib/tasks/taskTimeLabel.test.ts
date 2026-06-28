import type { Recurrence } from "@timedata/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recurrenceSummary } from "./recurrence.js";
import { taskTimeLabel } from "./taskTimeLabel.js";

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

  it("重复 -> recurrence summary 非占位非月日", () => {
    const recurrence: Recurrence = { freq: "daily", interval: 1, basis: "due" };

    const label = taskTimeLabel({ recurrence, scheduledAt: "2026-06-20T00:00:00.000Z" });

    expect(label).toBe(recurrenceSummary(recurrence));
    expect(label).not.toBe("设定时间");
    expect(label).not.toBe("6月20日");
  });
});