import { describe, expect, it } from "vitest";
import { deletedStats, type ArchiveItem } from "./deletedStats.js";

function makeItem(overrides: Partial<ArchiveItem> & { taskId: string }): ArchiveItem {
  return {
    deletedAt: "2026-07-20T00:00:00.000Z",
    deleteReason: "user",
    snapshot: null,
    ...overrides,
  };
}

describe("deletedStats", () => {
  it("空数组全 0/空", () => {
    const result = deletedStats([]);
    expect(result).toEqual({
      total: 0,
      byWeek: [],
      byReason: [],
      survivalBuckets: [
        { label: "<7天", count: 0 },
        { label: "7-30天", count: 0 },
        { label: "30-90天", count: 0 },
        { label: ">90天", count: 0 },
      ],
      deletedAfterDone: 0,
    });
  });

  it("坏 snapshot(null)行只进 total 与 byReason，不进 survivalBuckets/deletedAfterDone", () => {
    const items: ArchiveItem[] = [
      makeItem({ taskId: "a", deleteReason: "expired", snapshot: null }),
    ];
    const result = deletedStats(items);
    expect(result.total).toBe(1);
    expect(result.byReason).toEqual([{ reason: "expired", count: 1 }]);
    expect(result.survivalBuckets.every((b) => b.count === 0)).toBe(true);
    expect(result.deletedAfterDone).toBe(0);
  });

  it("存活时长分桶边界：恰好 7/30/90 天整归入更大的桶（左闭右开）", () => {
    const base = new Date("2026-07-08T00:00:00.000Z").getTime();
    const items: ArchiveItem[] = [
      makeItem({
        taskId: "exact7",
        deletedAt: new Date(base + 7 * 24 * 60 * 60 * 1000).toISOString(),
        snapshot: { createdAt: new Date(base).toISOString() },
      }),
      makeItem({
        taskId: "exact30",
        deletedAt: new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString(),
        snapshot: { createdAt: new Date(base).toISOString() },
      }),
      makeItem({
        taskId: "exact90",
        deletedAt: new Date(base + 90 * 24 * 60 * 60 * 1000).toISOString(),
        snapshot: { createdAt: new Date(base).toISOString() },
      }),
      makeItem({
        taskId: "under7",
        deletedAt: new Date(base + 6 * 24 * 60 * 60 * 1000).toISOString(),
        snapshot: { createdAt: new Date(base).toISOString() },
      }),
    ];
    const result = deletedStats(items);
    const byLabel = Object.fromEntries(result.survivalBuckets.map((b) => [b.label, b.count]));
    expect(byLabel["<7天"]).toBe(1); // under7
    expect(byLabel["7-30天"]).toBe(1); // exact7
    expect(byLabel["30-90天"]).toBe(1); // exact30
    expect(byLabel[">90天"]).toBe(1); // exact90
  });

  it("deletedAfterDone 只数有 snapshot 且 completedAt 非空的行", () => {
    const items: ArchiveItem[] = [
      makeItem({ taskId: "a", snapshot: { createdAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-10T00:00:00.000Z" } }),
      makeItem({ taskId: "b", snapshot: { createdAt: "2026-07-01T00:00:00.000Z", completedAt: null } }),
      makeItem({ taskId: "c", snapshot: null }),
    ];
    const result = deletedStats(items);
    expect(result.deletedAfterDone).toBe(1);
  });

  it("byWeek 按 deletedAt 所在周(周一起)聚合", () => {
    const items: ArchiveItem[] = [
      makeItem({ taskId: "a", deletedAt: "2026-07-20T04:00:00.000Z" }), // Asia/Shanghai 2026-07-20 (Mon)
      makeItem({ taskId: "b", deletedAt: "2026-07-21T04:00:00.000Z" }),
    ];
    const result = deletedStats(items);
    expect(result.byWeek).toEqual([{ weekStart: "2026-07-20", count: 2 }]);
  });

  it("byWeek 对齐 distribution 补零口径：跨度内的空周也补 0", () => {
    const items: ArchiveItem[] = [
      makeItem({ taskId: "a", deletedAt: "2026-07-06T04:00:00.000Z" }), // 周一 2026-07-06
      makeItem({ taskId: "b", deletedAt: "2026-07-20T04:00:00.000Z" }), // 周一 2026-07-20，中间隔两个空周
    ];
    const result = deletedStats(items);
    expect(result.byWeek).toEqual([
      { weekStart: "2026-07-06", count: 1 },
      { weekStart: "2026-07-13", count: 0 },
      { weekStart: "2026-07-20", count: 1 },
    ]);
  });

  it("snapshot.createdAt 为 null(旧快照契约容错)的行不进 survivalBuckets，但仍进 total/byReason", () => {
    const items: ArchiveItem[] = [
      makeItem({ taskId: "a", deleteReason: "expired", snapshot: { createdAt: null } }),
    ];
    const result = deletedStats(items);
    expect(result.total).toBe(1);
    expect(result.byReason).toEqual([{ reason: "expired", count: 1 }]);
    expect(result.survivalBuckets.every((b) => b.count === 0)).toBe(true);
  });

  it("survivalBuckets 排除 snapshot.ruleId 非空的 occurrence 行(createdAt 是物化时刻不是立 flag 时刻)", () => {
    const items: ArchiveItem[] = [
      makeItem({
        taskId: "occ",
        deletedAt: "2026-07-20T00:00:00.000Z",
        snapshot: { createdAt: "2026-07-19T00:00:00.000Z", ruleId: "rule1" }, // 若不排除会落 "<7天" 桶
      }),
    ];
    const result = deletedStats(items);
    expect(result.survivalBuckets.every((b) => b.count === 0)).toBe(true);
  });

  it("deletedAfterDone 排除 snapshot.recurrence 非空的模板行(陈旧 completedAt 不代表完成过)", () => {
    const items: ArchiveItem[] = [
      makeItem({
        taskId: "tpl",
        snapshot: {
          createdAt: "2026-07-01T00:00:00.000Z",
          completedAt: "2026-07-05T00:00:00.000Z", // 补加 recurrence 前遗留的陈旧 completedAt
          recurrence: { freq: "daily", interval: 1, basis: "due" },
        },
      }),
    ];
    const result = deletedStats(items);
    expect(result.deletedAfterDone).toBe(0);
  });
});
