import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildOverviewInsights } from "./overview.js";

function cat(id: string, parentId: string | null, name = id): Category {
  return {
    id,
    name,
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

const categories = [
  cat("work", null, "工作"),
  cat("coding", "work", "编码"),
  cat("meeting", "work", "会议"),
  cat("sleep", null, "睡眠"),
];

describe("buildOverviewInsights", () => {
  it("计算父分类与子分类二级占比", () => {
    const overview = buildOverviewInsights({
      entries: [
        entry("c1", "coding", "2026-05-08T01:00:00.000Z", "2026-05-08T03:00:00.000Z"),
        entry("m1", "meeting", "2026-05-08T03:00:00.000Z", "2026-05-08T04:00:00.000Z"),
      ],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: null,
    });

    expect(overview.totalRecordedMin).toBe(180);
    expect(overview.parents[0]).toMatchObject({ parentId: "work", totalMin: 180, sharePct: 100 });
    expect(overview.parents[0].children.map((child) => [child.categoryId, child.shareOfParentPct])).toEqual([
      ["coding", 66.7],
      ["meeting", 33.3],
    ]);
  });

  it("按周期边界裁剪记录时长", () => {
    const overview = buildOverviewInsights({
      entries: [
        entry("before", "coding", "2026-05-07T15:00:00.000Z", "2026-05-07T18:00:00.000Z"), // +8 23:00~02:00
        entry("after", "meeting", "2026-05-08T15:00:00.000Z", "2026-05-08T18:00:00.000Z"), // +8 23:00~02:00
      ],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: null,
    });

    expect(overview.totalRecordedMin).toBe(180);
  });

  it("覆盖率扣除睡眠分钟，并保留原始值但展示 clamp 到 100%", () => {
    const overview = buildOverviewInsights({
      entries: [
        entry("sleep", "sleep", "2026-05-07T15:00:00.000Z", "2026-05-07T23:00:00.000Z"),
        entry("work", "coding", "2026-05-08T00:00:00.000Z", "2026-05-08T16:00:00.000Z"),
      ],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: "sleep",
    });

    expect(overview.sleepMin).toBe(420);
    expect(overview.awakeMin).toBe(1020);
    expect(overview.coverageRawPct).toBeGreaterThan(100);
    expect(overview.coverageDisplayPct).toBe(100);
    expect(overview.coverageStatus).toBe("normal");
  });

  it("未指定睡眠分类时按全天估算并标注未扣除睡眠", () => {
    const overview = buildOverviewInsights({
      entries: [entry("work", "coding", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z")],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: null,
    });

    expect(overview.awakeMin).toBe(1440);
    expect(overview.coverageStatus).toBe("sleepNotConfigured");
    expect(overview.coverageNote).toBe("未扣除睡眠");
  });

  it("指定睡眠分类但无睡眠样本时按全天估算并标注暂无睡眠样本", () => {
    const overview = buildOverviewInsights({
      entries: [entry("work", "coding", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z")],
      categories,
      fromDate: "2026-05-08",
      toDate: "2026-05-08",
      sleepCategoryId: "sleep",
    });

    expect(overview.awakeMin).toBe(1440);
    expect(overview.coverageStatus).toBe("noSleepSamples");
    expect(overview.coverageNote).toBe("暂无睡眠样本");
  });
});
