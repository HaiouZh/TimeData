import { describe, expect, it } from "vitest";
import type { Category, TimeEntry } from "@timedata/shared";
import { buildStatsRange, buildStatsRangeForDate, summarizeEntriesByParentCategory } from "./stats.js";

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

  it("builds week and month ranges from local whole-day boundaries", () => {
    expect(buildStatsRange("week", new Date("2026-05-08T12:00:00+08:00"))).toMatchObject({
      fromDate: "2026-05-02",
      toDate: "2026-05-08",
      startUtc: "2026-05-01T16:00:00.000Z",
      endUtc: "2026-05-08T16:00:00.000Z",
    });
    expect(buildStatsRange("month", new Date("2026-05-08T12:00:00+08:00"))).toMatchObject({
      fromDate: "2026-04-09",
      toDate: "2026-05-08",
      startUtc: "2026-04-08T16:00:00.000Z",
      endUtc: "2026-05-08T16:00:00.000Z",
    });
  });

  it("builds ranges from an explicit local date string", () => {
    expect(buildStatsRangeForDate("week", "2026-05-08")).toMatchObject({
      fromDate: "2026-05-02",
      toDate: "2026-05-08",
      startUtc: "2026-05-01T16:00:00.000Z",
      endUtc: "2026-05-08T16:00:00.000Z",
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
