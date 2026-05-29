import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildDailyRollups } from "./dailyRollup.js";

function cat(id: string, parentId: string | null): Category {
  return { id, name: id, parentId, color: "#808080", icon: null, sortOrder: 0, isArchived: false, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}
function entry(id: string, categoryId: string, start: string, end: string): TimeEntry {
  return { id, categoryId, startTime: start, endTime: end, note: null, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}
const categories = [cat("p1", null), cat("c1", "p1")];

describe("buildDailyRollups", () => {
  it("单日条目归入对应本地日并累加分钟", () => {
    // 2026-05-08 09:00~11:00 (+08) = 01:00~03:00Z，120min
    const rollups = buildDailyRollups(
      [entry("a", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T03:00:00.000Z")],
      categories,
      "2026-05-08",
      "2026-05-08",
    );
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({ date: "2026-05-08", totalMin: 120 });
    expect(rollups[0].byParent.p1).toBe(120);
  });

  it("跨本地午夜条目按 24:00 边界拆到两天，单日不超 1440", () => {
    // 2026-05-08 22:00 ~ 2026-05-09 02:00 (+08) = 14:00Z ~ 18:00Z
    // 拆分：05-08 得 22:00~24:00 = 120min；05-09 得 00:00~02:00 = 120min
    const rollups = buildDailyRollups(
      [entry("a", "c1", "2026-05-08T14:00:00.000Z", "2026-05-08T18:00:00.000Z")],
      categories,
      "2026-05-08",
      "2026-05-09",
    );
    const d8 = rollups.find((r) => r.date === "2026-05-08");
    const d9 = rollups.find((r) => r.date === "2026-05-09");
    expect(d8?.totalMin).toBe(120);
    expect(d9?.totalMin).toBe(120);
    expect(rollups.every((r) => r.totalMin <= 1440)).toBe(true);
  });

  it("范围内完全无记录的日产出 totalMin=0 的空桶", () => {
    const rollups = buildDailyRollups(
      [entry("a", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z")],
      categories,
      "2026-05-08",
      "2026-05-10",
    );
    expect(rollups.map((r) => r.date)).toEqual(["2026-05-08", "2026-05-09", "2026-05-10"]);
    expect(rollups.find((r) => r.date === "2026-05-09")?.totalMin).toBe(0);
    expect(rollups.find((r) => r.date === "2026-05-09")?.segments).toEqual([]);
  });

  it("记录 firstActivity/lastActivity 为该日裁剪后的边界", () => {
    const rollups = buildDailyRollups(
      [
        entry("a", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"),
        entry("b", "c1", "2026-05-08T05:00:00.000Z", "2026-05-08T06:00:00.000Z"),
      ],
      categories,
      "2026-05-08",
      "2026-05-08",
    );
    expect(rollups[0].firstActivity).toBe("2026-05-08T01:00:00.000Z");
    expect(rollups[0].lastActivity).toBe("2026-05-08T06:00:00.000Z");
  });

  // 防御分支：非法时间区间（endMs <= startMs）应跳过，不影响其他条目
  it("非法时间区间（end <= start）的条目被跳过", () => {
    const rollups = buildDailyRollups(
      [
        entry("bad1", "c1", "2026-05-08T03:00:00.000Z", "2026-05-08T03:00:00.000Z"), // end == start
        entry("bad2", "c1", "2026-05-08T05:00:00.000Z", "2026-05-08T04:00:00.000Z"), // end < start
        entry("ok", "c1", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z"),  // 60min 有效
      ],
      categories,
      "2026-05-08",
      "2026-05-08",
    );
    expect(rollups[0].totalMin).toBe(60);
    expect(rollups[0].segments).toHaveLength(1);
  });

  // 防御分支：未知分类归到 "unknown" 父桶
  it("未知 categoryId 归到 unknown 父桶", () => {
    const rollups = buildDailyRollups(
      [entry("a", "nonexistent", "2026-05-08T01:00:00.000Z", "2026-05-08T02:00:00.000Z")],
      categories,
      "2026-05-08",
      "2026-05-08",
    );
    expect(rollups[0].byParent["unknown"]).toBe(60);
    expect(rollups[0].totalMin).toBe(60);
  });

  // 防御分支：空条目列表仍产出完整日期桶
  it("空条目列表产出全空桶，totalMin 均为 0", () => {
    const rollups = buildDailyRollups([], categories, "2026-05-08", "2026-05-10");
    expect(rollups).toHaveLength(3);
    expect(rollups.every((r) => r.totalMin === 0)).toBe(true);
    expect(rollups.every((r) => r.firstActivity === null)).toBe(true);
  });

  // listDates 边界：fromDate == toDate 时只产出 1 天
  it("fromDate 等于 toDate 时只产出单日", () => {
    const rollups = buildDailyRollups([], categories, "2026-05-08", "2026-05-08");
    expect(rollups).toHaveLength(1);
    expect(rollups[0].date).toBe("2026-05-08");
  });
});
