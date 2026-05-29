import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  buildStatsRange,
  buildStatsRangeForDate,
  formatStatsRangeLabel,
  isLatestPeriod,
  shiftStatsAnchor,
  summarizeEntriesByParentCategory,
} from "./stats.js";

function entry(id: string, categoryId: string, startTime: string, endTime: string): TimeEntry {
  return {
    id,
    categoryId,
    startTime,
    endTime,
    note: null,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
  };
}

const parent: Category = {
  id: "work",
  name: "工作",
  color: "#2563eb",
  icon: "briefcase",
  parentId: null,
  sortOrder: 0,
  createdAt: "2026-05-08T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

const child: Category = {
  id: "coding",
  name: "编程",
  color: "#60a5fa",
  icon: "code",
  parentId: "work",
  sortOrder: 0,
  createdAt: "2026-05-08T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

const orphanChild: Category = {
  id: "orphan-coding",
  name: "孤儿编程",
  color: "#f97316",
  icon: "code",
  parentId: "missing-work",
  sortOrder: 0,
  createdAt: "2026-05-08T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

const anotherOrphanChild: Category = {
  id: "orphan-meeting",
  name: "孤儿会议",
  color: "#22c55e",
  icon: "users",
  parentId: "missing-meeting",
  sortOrder: 1,
  createdAt: "2026-05-08T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

describe("stats helpers", () => {
  it("counts only the visible part of a cross-day entry in a local day window", () => {
    const range = buildStatsRange("day", new Date("2026-05-08T12:00:00+08:00"));
    const rows = summarizeEntriesByParentCategory(
      [entry("overnight", "coding", "2026-05-07T15:00:00.000Z", "2026-05-07T17:00:00.000Z")],
      [child],
      [parent],
      range,
    );

    expect(rows).toEqual([{ id: "work", name: "工作", value: 1, color: "#2563eb" }]);
  });

  it("skips entries outside the range and invalid time ranges", () => {
    const range = buildStatsRange("day", new Date("2026-05-08T12:00:00+08:00"));
    const rows = summarizeEntriesByParentCategory(
      [
        entry("outside", "coding", "2026-05-06T01:00:00.000Z", "2026-05-06T02:00:00.000Z"),
        entry("invalid", "coding", "bad", "2026-05-08T02:00:00.000Z"),
      ],
      [child],
      [parent],
      range,
    );

    expect(rows).toEqual([]);
  });

  it("builds calendar week and month ranges from local whole-day boundaries", () => {
    // 2026-05-08 是周五；自然周 = 周一 2026-05-04 ~ 周日 2026-05-10
    expect(buildStatsRange("week", new Date("2026-05-08T12:00:00+08:00"))).toMatchObject({
      fromDate: "2026-05-04",
      toDate: "2026-05-10",
      startUtc: "2026-05-03T16:00:00.000Z",
      endUtc: "2026-05-10T16:00:00.000Z",
    });
    // 自然月 = 2026-05-01 ~ 2026-05-31
    expect(buildStatsRange("month", new Date("2026-05-08T12:00:00+08:00"))).toMatchObject({
      fromDate: "2026-05-01",
      toDate: "2026-05-31",
      startUtc: "2026-04-30T16:00:00.000Z",
      endUtc: "2026-05-31T16:00:00.000Z",
    });
  });

  it("builds calendar week range from an explicit local date string", () => {
    expect(buildStatsRangeForDate("week", "2026-05-08")).toMatchObject({
      fromDate: "2026-05-04",
      toDate: "2026-05-10",
      startUtc: "2026-05-03T16:00:00.000Z",
      endUtc: "2026-05-10T16:00:00.000Z",
    });
  });

  it("builds day ranges from an explicit local date string", () => {
    expect(buildStatsRangeForDate("day", "2026-05-08")).toMatchObject({
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      startUtc: "2026-05-07T16:00:00.000Z",
      endUtc: "2026-05-08T16:00:00.000Z",
    });
  });

  it("groups categories with missing parents into one unknown row", () => {
    const range = buildStatsRange("day", new Date("2026-05-08T12:00:00+08:00"));
    const rows = summarizeEntriesByParentCategory(
      [
        entry("orphan-coding-entry", "orphan-coding", "2026-05-07T16:00:00.000Z", "2026-05-07T17:00:00.000Z"),
        entry("orphan-meeting-entry", "orphan-meeting", "2026-05-07T17:00:00.000Z", "2026-05-07T18:00:00.000Z"),
      ],
      [orphanChild, anotherOrphanChild],
      [parent],
      range,
    );

    expect(rows).toEqual([{ id: "unknown", name: "其他", value: 2, color: "#808080" }]);
  });
});

describe("stats navigation helpers", () => {
  it("shiftStatsAnchor: 按周期前后移动锚点", () => {
    expect(shiftStatsAnchor("day", "2026-05-08", -1)).toBe("2026-05-07");
    expect(shiftStatsAnchor("day", "2026-05-08", 1)).toBe("2026-05-09");
    expect(shiftStatsAnchor("week", "2026-05-08", -1)).toBe("2026-05-01");
    expect(shiftStatsAnchor("week", "2026-05-08", 1)).toBe("2026-05-15");
    expect(shiftStatsAnchor("month", "2026-05-08", -1)).toBe("2026-04-08");
    expect(shiftStatsAnchor("month", "2026-05-08", 1)).toBe("2026-06-08");
    expect(shiftStatsAnchor("month", "2026-01-31", 1)).toBe("2026-02-28"); // 月末钳制
    expect(shiftStatsAnchor("month", "2026-03-31", -1)).toBe("2026-02-28"); // 退月钳制
  });

  it("isLatestPeriod: 周期含今天或在其后时为 true", () => {
    expect(isLatestPeriod("week", "2026-05-08", "2026-05-06")).toBe(true);
    expect(isLatestPeriod("week", "2026-05-01", "2026-05-20")).toBe(false);
    expect(isLatestPeriod("month", "2026-05-15", "2026-05-31")).toBe(true);
    expect(isLatestPeriod("month", "2026-04-15", "2026-05-31")).toBe(false);
    expect(isLatestPeriod("day", "2026-05-08", "2026-05-08")).toBe(true); // 当天
    expect(isLatestPeriod("day", "2026-05-07", "2026-05-08")).toBe(false); // 昨天周期已过
    expect(isLatestPeriod("day", "2026-05-09", "2026-05-08")).toBe(true); // 未来
  });

  it("formatStatsRangeLabel: 各周期标签", () => {
    expect(formatStatsRangeLabel("day", buildStatsRangeForDate("day", "2026-05-08"))).toBe("2026-05-08");
    expect(formatStatsRangeLabel("week", buildStatsRangeForDate("week", "2026-05-08"))).toBe(
      "2026-05-04 ~ 2026-05-10",
    );
    expect(formatStatsRangeLabel("month", buildStatsRangeForDate("month", "2026-05-08"))).toBe("2026年05月");
  });
});
