import type { Recurrence } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { recurrenceSummary } from "./recurrence.js";
import { taskTimeLabel } from "./taskTimeLabel.js";

describe("taskTimeLabel", () => {
  it("无重复无日期 -> 设定时间", () => {
    expect(taskTimeLabel({ recurrence: null, scheduledAt: null })).toBe("设定时间");
  });

  it("scheduledAt -> M/D", () => {
    expect(taskTimeLabel({ recurrence: null, scheduledAt: "2026-06-20T00:00:00.000Z" })).toBe("6/20");
  });

  it("重复 -> recurrence summary 非占位非月日", () => {
    const recurrence: Recurrence = { freq: "daily", interval: 1, basis: "due" };

    const label = taskTimeLabel({ recurrence, scheduledAt: "2026-06-20T00:00:00.000Z" });

    expect(label).toBe(recurrenceSummary(recurrence));
    expect(label).not.toBe("设定时间");
    expect(label).not.toBe("6/20");
  });
});
