import type { HealthRun, HealthSleep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { getMetricDef, listMetricDefs } from "./registry.js";

function sleep(partial: Partial<HealthSleep>): HealthSleep {
  return {
    id: partial.id ?? "s1",
    date: partial.date ?? "2026-06-01",
    sleepStart: partial.sleepStart ?? "23:00",
    wakeTime: partial.wakeTime ?? "07:00",
    adjustmentHours: partial.adjustmentHours ?? 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function run(partial: Partial<HealthRun>): HealthRun {
  return {
    id: partial.id ?? "r1",
    date: partial.date ?? "2026-06-01",
    startTime: partial.startTime ?? "08:00",
    distanceKm: partial.distanceKm === undefined ? 5 : partial.distanceKm,
    durationSeconds: partial.durationSeconds === undefined ? 1800 : partial.durationSeconds,
    averageHeartRate: partial.averageHeartRate ?? null,
    averageCadence: null,
    averageStrideM: null,
    averageVerticalRatioPercent: null,
    averageVerticalOscillationCm: null,
    averageGroundContactMs: null,
    type: partial.type ?? "",
    city: partial.city ?? "",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("registry", () => {
  it("收录所有 v1 指标且 id 唯一", () => {
    const ids = listMetricDefs().map((def) => def.id);
    expect(ids).toContain("sleep.duration");
    expect(ids).toContain("run.pace");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sleep.start 入睡<19点转 24+ 小时", () => {
    const def = getMetricDef("sleep.start");
    const map = def.selectByDate({ sleeps: [sleep({ date: "2026-06-02", sleepStart: "18:30" })] });
    expect(map.get("2026-06-02")).toBeCloseTo(18.5 + 24, 5);
  });

  it("sleep.start 入睡>=19点不偏移", () => {
    const def = getMetricDef("sleep.start");
    const map = def.selectByDate({ sleeps: [sleep({ date: "2026-06-02", sleepStart: "23:00" })] });
    expect(map.get("2026-06-02")).toBeCloseTo(23, 5);
  });

  it("run.distance 当日多次求和", () => {
    const def = getMetricDef("run.distance");
    const map = def.selectByDate({
      runs: [run({ id: "a", distanceKm: 5 }), run({ id: "b", distanceKm: 3 })],
    });
    expect(map.get("2026-06-01")).toBeCloseTo(8, 5);
  });

  it("run.count 当日计数", () => {
    const def = getMetricDef("run.count");
    const map = def.selectByDate({ runs: [run({ id: "a" }), run({ id: "b" })] });
    expect(map.get("2026-06-01")).toBe(2);
  });

  it("run.pace 当日总时长/总距离（秒/公里）", () => {
    const def = getMetricDef("run.pace");
    const map = def.selectByDate({
      runs: [
        run({ id: "a", distanceKm: 5, durationSeconds: 1500 }),
        run({ id: "b", distanceKm: 5, durationSeconds: 1800 }),
      ],
    });
    // (1500+1800) / (5+5) = 330 秒/公里
    expect(map.get("2026-06-01")).toBeCloseTo(330, 5);
  });

  it("run.pace 暴露 paceComponentsByDate 供 rolling", () => {
    const def = getMetricDef("run.pace");
    const components = def.paceComponentsByDate?.({
      runs: [run({ id: "a", distanceKm: 5, durationSeconds: 1500 })],
    });
    expect(components?.get("2026-06-01")).toEqual({ durationSeconds: 1500, distanceKm: 5 });
  });

  it("缺值跑步不计入聚合", () => {
    const def = getMetricDef("run.distance");
    const map = def.selectByDate({ runs: [run({ id: "a", distanceKm: null }), run({ id: "b", distanceKm: 4 })] });
    expect(map.get("2026-06-01")).toBeCloseTo(4, 5);
  });
});
