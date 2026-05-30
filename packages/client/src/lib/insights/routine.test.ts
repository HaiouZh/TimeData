import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildRoutineInsights, formatClockFromMinute } from "./routine.js";

function cat(id: string, parentId: string | null): Category {
  return {
    id,
    name: id,
    parentId,
    color: "#808080",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function entry(id: string, categoryId: string, start: string, end: string): TimeEntry {
  return {
    id,
    categoryId,
    startTime: start,
    endTime: end,
    note: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

const categories = [cat("work", null), cat("sleep", null), cat("nap", "sleep")];

describe("buildRoutineInsights", () => {
  it("未指定睡眠分类时回退默认窗口", () => {
    const routine = buildRoutineInsights({
      entries: [],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: null,
    });

    expect(routine.sleepCategoryConfigured).toBe(false);
    expect(routine.regularity.state).toBe("notConfigured");
    expect(routine.sleepWindow).toEqual({ startMin: 1380, endMin: 420, source: "fallback" });
  });

  it("指定睡眠分类但无样本时只展示无样本状态", () => {
    const routine = buildRoutineInsights({
      entries: [entry("w1", "work", "2026-05-08T01:00:00.000Z", "2026-05-08T03:00:00.000Z")],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: "sleep",
    });

    expect(routine.sampleCount).toBe(0);
    expect(routine.regularity.state).toBe("noSamples");
  });

  it("按醒来的本地日期归属跨天主睡眠段，并计入同日碎片睡眠", () => {
    const routine = buildRoutineInsights({
      entries: [
        entry("main", "sleep", "2026-05-07T15:30:00.000Z", "2026-05-07T23:00:00.000Z"), // +8 23:30~07:00
        entry("nap", "nap", "2026-05-08T05:00:00.000Z", "2026-05-08T05:30:00.000Z"), // +8 13:00~13:30
      ],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: "sleep",
    });

    expect(routine.samples).toHaveLength(1);
    expect(routine.samples[0]).toMatchObject({
      date: "2026-05-08",
      bedTimeMin: 23 * 60 + 30,
      wakeTimeMin: 7 * 60,
      durationMin: 480,
      mainDurationMin: 450,
    });
  });

  it("样本不足时不判断稳定性，睡眠窗口仍用默认值", () => {
    const routine = buildRoutineInsights({
      entries: [
        entry("s1", "sleep", "2026-05-07T15:30:00.000Z", "2026-05-07T23:00:00.000Z"),
        entry("s2", "sleep", "2026-05-08T15:40:00.000Z", "2026-05-08T23:10:00.000Z"),
      ],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-09",
      sleepCategoryId: "sleep",
    });

    expect(routine.sampleCount).toBe(2);
    expect(routine.regularity.state).toBe("insufficientSamples");
    expect(routine.sleepWindow.source).toBe("fallback");
  });

  it("低于 3h 的睡眠段不作为入睡/起床主锚点", () => {
    const routine = buildRoutineInsights({
      entries: [
        entry("short", "sleep", "2026-05-07T16:00:00.000Z", "2026-05-07T18:30:00.000Z"),
        entry("main", "sleep", "2026-05-07T19:00:00.000Z", "2026-05-08T01:00:00.000Z"),
      ],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: "sleep",
    });

    expect(routine.samples).toHaveLength(1);
    expect(formatClockFromMinute(routine.samples[0].bedTimeMin)).toBe("03:00");
    expect(routine.samples[0].durationMin).toBe(510);
  });

  it("七天以上样本按中位数外扩推导个体睡眠窗口并判断稳定", () => {
    const routine = buildRoutineInsights({
      entries: [
        entry("s1", "sleep", "2026-05-07T17:00:00.000Z", "2026-05-08T01:00:00.000Z"), // +8 01:00~09:00
        entry("s2", "sleep", "2026-05-08T17:10:00.000Z", "2026-05-09T01:05:00.000Z"),
        entry("s3", "sleep", "2026-05-09T16:50:00.000Z", "2026-05-10T00:55:00.000Z"),
        entry("s4", "sleep", "2026-05-10T17:00:00.000Z", "2026-05-11T01:00:00.000Z"),
        entry("s5", "sleep", "2026-05-11T17:05:00.000Z", "2026-05-12T01:00:00.000Z"),
        entry("s6", "sleep", "2026-05-12T16:55:00.000Z", "2026-05-13T00:55:00.000Z"),
        entry("s7", "sleep", "2026-05-13T17:00:00.000Z", "2026-05-14T01:05:00.000Z"),
      ],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-14",
      sleepCategoryId: "sleep",
    });

    expect(routine.regularity.state).toBe("stable");
    expect(routine.sleepWindow.source).toBe("samples");
    expect(formatClockFromMinute(routine.sleepWindow.startMin)).toBe("00:00");
    expect(formatClockFromMinute(routine.sleepWindow.endMin)).toBe("10:00");
  });
});
