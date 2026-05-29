import { describe, expect, it } from "vitest";
import type { InsightSession } from "./types.js";
import type { DailyRollup } from "./types.js";
import { computeDepthMetrics, computeDepthThresholds, computeEntropy, computeImbalance, poolSessions, switchesPerActiveHour } from "./structure.js";

function session(parentId: string, durationMin: number): InsightSession {
  return { parentId, startTime: "2026-05-08T02:00:00.000Z", endTime: "2026-05-08T03:00:00.000Z", entryIds: ["e"], durationMin };
}

describe("poolSessions", () => {
  it("指定睡眠分类时排除睡眠父，并滤掉噪声会话(<minSessionMin)", () => {
    const sessions = [session("work", 30), session("sleep", 480), session("work", 0.5)];
    const pool = poolSessions(sessions, "sleep");
    expect(pool.map((s) => s.parentId)).toEqual(["work"]);
    expect(pool[0].durationMin).toBe(30);
  });

  it("未指定睡眠分类时保留所有非噪声会话", () => {
    const sessions = [session("work", 30), session("sleep", 480)];
    expect(poolSessions(sessions, null).length).toBe(2);
  });
});

describe("computeDepthThresholds", () => {
  it("深度阈值 = max(P70, floor)，碎片阈值 = P30", () => {
    const t = computeDepthThresholds([10, 30, 50, 200]);
    expect(t.deepThresholdMin).toBe(65);
    expect(t.fragmentThresholdMin).toBe(28);
  });

  it("会话过短时 floor 兜底深度阈值", () => {
    const t = computeDepthThresholds([5, 8, 10]);
    expect(t.deepThresholdMin).toBe(20);
  });

  it("空基线退化：深度阈值=floor、碎片阈值=0", () => {
    expect(computeDepthThresholds([])).toEqual({ deepThresholdMin: 20, fragmentThresholdMin: 0 });
  });
});

describe("computeDepthMetrics", () => {
  it("深度块/碎片/中位/占比按阈值计算", () => {
    const pool = [session("a", 20), session("a", 30), session("a", 90), session("a", 120)];
    const m = computeDepthMetrics(pool, { deepThresholdMin: 60, fragmentThresholdMin: 30 });
    expect(m).toEqual({
      sessionCount: 4,
      totalMin: 260,
      medianSessionMin: 60,
      deepBlockCount: 2,
      deepMin: 210,
      deepRatioPct: 80.8,
      fragmentSessionCount: 2,
      fragmentMin: 50,
      fragmentRatioPct: 19.2,
    });
  });

  it("空池产出全 0", () => {
    const m = computeDepthMetrics([], { deepThresholdMin: 60, fragmentThresholdMin: 30 });
    expect(m.sessionCount).toBe(0);
    expect(m.totalMin).toBe(0);
    expect(m.deepRatioPct).toBe(0);
    expect(m.medianSessionMin).toBe(0);
  });
});

function rollup(date: string, byParent: Record<string, number>, segments: DailyRollup["segments"]): DailyRollup {
  const totalMin = Object.values(byParent).reduce((a, b) => a + b, 0);
  return { date, totalMin, byParent, segments, firstActivity: null, lastActivity: null };
}
function seg(parentId: string, start: string, end: string): DailyRollup["segments"][number] {
  return { start, end, categoryId: parentId, parentId };
}

describe("switchesPerActiveHour", () => {
  it("按非睡眠段计父分类切换 / 活跃小时桶", () => {
    const r = rollup("2026-05-08", {}, [
      seg("X", "2026-05-08T02:00:00.000Z", "2026-05-08T03:00:00.000Z"),
      seg("Y", "2026-05-08T03:00:00.000Z", "2026-05-08T04:00:00.000Z"),
      seg("X", "2026-05-08T04:00:00.000Z", "2026-05-08T04:30:00.000Z"),
    ]);
    expect(switchesPerActiveHour([r], null)).toBe(0.67);
  });

  it("跨小时但不足整小时的段按覆盖到的本地小时桶计分母，整点结束不含结束小时", () => {
    const r = rollup("2026-05-08", {}, [
      seg("X", "2026-05-08T02:30:00.000Z", "2026-05-08T03:30:00.000Z"),
      seg("Y", "2026-05-08T03:30:00.000Z", "2026-05-08T04:00:00.000Z"),
    ]);
    expect(switchesPerActiveHour([r], null)).toBe(0.5);
  });

  it("整点结束不包含结束小时桶", () => {
    const r = rollup("2026-05-08", {}, [seg("X", "2026-05-08T02:00:00.000Z", "2026-05-08T03:00:00.000Z")]);
    expect(switchesPerActiveHour([r], null)).toBe(0);
  });

  it("指定睡眠分类时排除睡眠段后再计切换", () => {
    const r = rollup("2026-05-08", {}, [
      seg("X", "2026-05-08T02:00:00.000Z", "2026-05-08T03:00:00.000Z"),
      seg("sleep", "2026-05-08T03:00:00.000Z", "2026-05-08T04:00:00.000Z"),
      seg("X", "2026-05-08T04:00:00.000Z", "2026-05-08T05:00:00.000Z"),
    ]);
    expect(switchesPerActiveHour([r], "sleep")).toBe(0);
  });

  it("指定睡眠分类时睡眠段会打断切换序列", () => {
    const r = rollup("2026-05-08", {}, [
      seg("work", "2026-05-08T14:00:00.000Z", "2026-05-08T15:00:00.000Z"),
      seg("sleep", "2026-05-08T15:00:00.000Z", "2026-05-08T23:00:00.000Z"),
      seg("exercise", "2026-05-08T23:00:00.000Z", "2026-05-09T00:00:00.000Z"),
    ]);
    expect(switchesPerActiveHour([r], "sleep")).toBe(0);
  });

  it("跨 rollup 的相邻非睡眠父分类切换会计入", () => {
    const day1 = rollup("2026-05-08", {}, [seg("work", "2026-05-08T15:00:00.000Z", "2026-05-08T16:00:00.000Z")]);
    const day2 = rollup("2026-05-09", {}, [seg("play", "2026-05-08T16:00:00.000Z", "2026-05-08T17:00:00.000Z")]);
    expect(switchesPerActiveHour([day1, day2], null)).toBe(0.5);
  });

  it("无段时返回 0", () => {
    expect(switchesPerActiveHour([rollup("2026-05-08", {}, [])], null)).toBe(0);
  });
});

describe("computeEntropy", () => {
  it("两类均分 H=1bit、归一化100%", () => {
    expect(computeEntropy({ a: 50, b: 50 })).toEqual({ entropyBits: 1, maxBits: 1, normalizedPct: 100, parentCount: 2 });
  });

  it("四类均分 H=2bit、归一化100%", () => {
    expect(computeEntropy({ a: 25, b: 25, c: 25, d: 25 })).toEqual({ entropyBits: 2, maxBits: 2, normalizedPct: 100, parentCount: 4 });
  });

  it("单类 H=0、parentCount=1", () => {
    expect(computeEntropy({ a: 100 })).toEqual({ entropyBits: 0, maxBits: 0, normalizedPct: 0, parentCount: 1 });
  });

  it("空分布全 0", () => {
    expect(computeEntropy({})).toEqual({ entropyBits: 0, maxBits: 0, normalizedPct: 0, parentCount: 0 });
  });
});

describe("computeImbalance", () => {
  const baseline8: DailyRollup[] = [
    rollup("2026-05-01", { work: 50, play: 20, misc: 30 }, []),
    rollup("2026-05-02", { work: 50, play: 20, misc: 30 }, []),
    rollup("2026-05-03", { work: 50, play: 20, misc: 30 }, []),
    rollup("2026-05-04", { work: 50, play: 20, misc: 30 }, []),
    rollup("2026-05-05", { work: 50, play: 30, misc: 20 }, []),
    rollup("2026-05-06", { work: 50, play: 30, misc: 20 }, []),
    rollup("2026-05-07", { work: 50, play: 30, misc: 20 }, []),
    rollup("2026-05-08", { work: 50, play: 30, misc: 20 }, []),
  ];

  it("当期占比偏离个人 σ 达阈值才报；σ=0 的类跳过；按 |z| 降序", () => {
    const items = computeImbalance({ work: 40, play: 55, misc: 5 }, baseline8);
    expect(items.map((i) => i.parentId)).toEqual(["play", "misc"]);
    expect(items.find((i) => i.parentId === "play")?.direction).toBe("high");
    expect(items.find((i) => i.parentId === "misc")?.direction).toBe("low");
    expect(items.some((i) => i.parentId === "work")).toBe(false);
  });

  it("基线有数据天数 < minDays 的类不评估（样本薄退化）", () => {
    const thin = baseline8.slice(0, 6);
    expect(computeImbalance({ work: 40, play: 55, misc: 5 }, thin)).toEqual([]);
  });

  it("单样本基线即使 minDays 配成 1 也不输出 NaN 失衡", () => {
    const oneDay = [rollup("2026-05-01", { work: 20 }, [])];
    expect(computeImbalance({ work: 50 }, oneDay, { imbalanceMinDaysWithData: 1 })).toEqual([]);
  });

  it("当期无记录时不报失衡", () => {
    expect(computeImbalance({}, baseline8)).toEqual([]);
  });
});

