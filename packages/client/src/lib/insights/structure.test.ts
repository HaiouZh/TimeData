import { describe, expect, it } from "vitest";
import type { InsightSession } from "./types.js";
import { computeDepthMetrics, computeDepthThresholds, poolSessions } from "./structure.js";

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
