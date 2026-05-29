import type { Category, TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildTrend, resolveTrendWindow } from "./trends.js";

function cat(id: string, parentId: string | null): Category {
  return { id, name: id, parentId, color: "#808080", icon: null, sortOrder: 0, isArchived: false, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}
function entry(id: string, categoryId: string, start: string, end: string): TimeEntry {
  return { id, categoryId, startTime: start, endTime: end, note: null, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
}

describe("resolveTrendWindow", () => {
  it("预设窗口 = 今天往前 N 天，上一窗口等长紧邻前移", () => {
    const w = resolveTrendWindow({ kind: "preset", days: 7 }, "2026-05-29");
    expect(w).toEqual({ from: "2026-05-23", to: "2026-05-29", prevFrom: "2026-05-16", prevTo: "2026-05-22" });
  });

  it("自定义天数同预设语义，并 clamp 到 [1,365]", () => {
    const w = resolveTrendWindow({ kind: "customDays", days: 400 }, "2026-05-29");
    expect(w.to).toBe("2026-05-29");
    expect(w.from).toBe("2025-05-30");
    const w1 = resolveTrendWindow({ kind: "customDays", days: 0 }, "2026-05-29");
    expect(w1.from).toBe("2026-05-29");
    expect(w1.to).toBe("2026-05-29");
  });

  it("自定义起止区间，上一窗口等长紧邻前移", () => {
    const w = resolveTrendWindow({ kind: "customRange", from: "2026-05-01", to: "2026-05-10" }, "2026-05-29");
    expect(w).toEqual({ from: "2026-05-01", to: "2026-05-10", prevFrom: "2026-04-21", prevTo: "2026-04-30" });
  });

  it("自定义区间 to 超过 today 时钳到 today", () => {
    const w = resolveTrendWindow({ kind: "customRange", from: "2026-05-25", to: "2026-06-30" }, "2026-05-29");
    expect(w.to).toBe("2026-05-29");
    expect(w.from).toBe("2026-05-25");
  });
});

// 父分类（均 parentId=null，resolveParentId 返回自身）。
const trendCats = [cat("work", null), cat("play", null), cat("invest", null), cat("ops", null)];

// 本期 from..to=05-08..10，上期 prevFrom..prevTo=05-05..07。
const window3 = { from: "2026-05-08", to: "2026-05-10", prevFrom: "2026-05-05", prevTo: "2026-05-07" };

// 投入设计（按午夜切分后分钟）：
//   work  本期 600(=200×3天) 上期 300(=100×3天)        -> compared +100%
//   play  本期 100(05-08)    上期 200(05-05,06 各100)  -> compared -50%
//   invest本期 120(05-08)    上期 10(05-05)            -> new(上期<30 floor)
//   ops   本期 0             上期 120(05-05)           -> dropped
const trendEntries: TimeEntry[] = [
  entry("w8", "work", "2026-05-08T02:00:00.000Z", "2026-05-08T05:20:00.000Z"),
  entry("w9", "work", "2026-05-09T02:00:00.000Z", "2026-05-09T05:20:00.000Z"),
  entry("w10", "work", "2026-05-10T02:00:00.000Z", "2026-05-10T05:20:00.000Z"),
  entry("w5", "work", "2026-05-05T02:00:00.000Z", "2026-05-05T03:40:00.000Z"),
  entry("w6", "work", "2026-05-06T02:00:00.000Z", "2026-05-06T03:40:00.000Z"),
  entry("w7", "work", "2026-05-07T02:00:00.000Z", "2026-05-07T03:40:00.000Z"),
  entry("p8", "play", "2026-05-08T06:00:00.000Z", "2026-05-08T07:40:00.000Z"),
  entry("p5", "play", "2026-05-05T06:00:00.000Z", "2026-05-05T07:40:00.000Z"),
  entry("p6", "play", "2026-05-06T06:00:00.000Z", "2026-05-06T07:40:00.000Z"),
  entry("i8", "invest", "2026-05-08T10:00:00.000Z", "2026-05-08T12:00:00.000Z"),
  entry("i5", "invest", "2026-05-05T09:00:00.000Z", "2026-05-05T09:10:00.000Z"),
  entry("o5", "ops", "2026-05-05T12:00:00.000Z", "2026-05-05T14:00:00.000Z"),
];

describe("buildTrend 环比分级", () => {
  it("compared 正/负、new、dropped 四态正确", () => {
    const r = buildTrend(trendEntries, trendCats, window3);
    expect(r.prevComparable).toBe(true);
    const byId = new Map(r.parentTrends.map((t) => [t.parentId, t]));
    expect(byId.get("work")).toMatchObject({ state: "compared", currentMin: 600, previousMin: 300, deltaPct: 100 });
    expect(byId.get("play")).toMatchObject({ state: "compared", currentMin: 100, previousMin: 200, deltaPct: -50 });
    expect(byId.get("invest")).toMatchObject({ state: "new", currentMin: 120, previousMin: 10, deltaPct: null });
    expect(byId.get("ops")).toMatchObject({ state: "dropped", currentMin: 0, previousMin: 120, deltaPct: null });
  });

  it("parentTrends 按本期投入降序", () => {
    const r = buildTrend(trendEntries, trendCats, window3);
    expect(r.parentTrends.map((t) => t.parentId)).toEqual(["work", "invest", "play", "ops"]);
  });

  it("TopN 只排 compared：上升 work、下降 play，dropped/new 不入榜", () => {
    const r = buildTrend(trendEntries, trendCats, window3);
    expect(r.topRising.map((t) => t.parentId)).toEqual(["work"]);
    expect(r.topFalling.map((t) => t.parentId)).toEqual(["play"]);
    expect(r.droppedParents.map((t) => t.parentId)).toEqual(["ops"]);
  });

  it("折线序列覆盖本期每一天（含 0 桶），按日含 byParent", () => {
    const r = buildTrend(trendEntries, trendCats, window3);
    expect(r.points.map((p) => p.date)).toEqual(["2026-05-08", "2026-05-09", "2026-05-10"]);
    expect(r.points[0].byParent.work).toBe(200);
    expect(r.points[0].byParent.play).toBe(100);
    expect(r.points[0].byParent.invest).toBe(120);
    expect(r.points[1].byParent).toEqual({ work: 200 });
  });

  it("上期数据天数不足时全部 noBaseline、TopN 空", () => {
    const emptyPrev = { from: "2026-05-08", to: "2026-05-10", prevFrom: "2026-05-01", prevTo: "2026-05-03" };
    const r = buildTrend(trendEntries, trendCats, emptyPrev);
    expect(r.prevComparable).toBe(false);
    expect(r.parentTrends.every((t) => t.state === "noBaseline")).toBe(true);
    expect(r.topRising).toEqual([]);
    expect(r.topFalling).toEqual([]);
  });

  it("上期微量(<floor)、本期归零的分类计入 compared -100%（非 dropped），锁定 floor 守卫不对称设计", () => {
    // 设计：dropped 要求上期 >= floor；上期投入低于 floor 又归零的分类，按 compared -100% 如实呈现，
    // 不当作"消失"。此用例锁定该刻意行为，避免后续误判为 bug。
    const cats = [cat("work", null), cat("tiny", null)];
    const entries = [
      // work 上期 3 天各 100min（保证 prevComparable），本期无 -> dropped
      entry("w5", "work", "2026-05-05T02:00:00.000Z", "2026-05-05T03:40:00.000Z"),
      entry("w6", "work", "2026-05-06T02:00:00.000Z", "2026-05-06T03:40:00.000Z"),
      entry("w7", "work", "2026-05-07T02:00:00.000Z", "2026-05-07T03:40:00.000Z"),
      // tiny 上期仅 10min(<30 floor)，本期无 -> compared -100%
      entry("t5", "tiny", "2026-05-05T09:00:00.000Z", "2026-05-05T09:10:00.000Z"),
    ];
    const r = buildTrend(entries, cats, window3);
    expect(r.prevComparable).toBe(true);
    const byId = new Map(r.parentTrends.map((t) => [t.parentId, t]));
    expect(byId.get("tiny")).toMatchObject({ state: "compared", currentMin: 0, previousMin: 10, deltaPct: -100 });
    expect(byId.get("work")).toMatchObject({ state: "dropped" });
    expect(r.topFalling.map((t) => t.parentId)).toEqual(["tiny"]);
    expect(r.droppedParents.map((t) => t.parentId)).toEqual(["work"]);
  });

  it("空 entries 产出空趋势、points 仍按窗口天数铺满", () => {
    const r = buildTrend([], trendCats, window3);
    expect(r.parentTrends).toEqual([]);
    expect(r.points.map((p) => p.date)).toEqual(["2026-05-08", "2026-05-09", "2026-05-10"]);
    expect(r.points.every((p) => Object.keys(p.byParent).length === 0)).toBe(true);
  });
});
