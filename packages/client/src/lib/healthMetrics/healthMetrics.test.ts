import type { HealthHeartRate, HealthHrv, HealthRun, HealthSleep, HealthStress } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  buildHealthSummary,
  buildNormalizedHealthTrend,
  buildRunPaceTrend,
  computeSleepDurationHours,
  filterHealthRecordsByRange,
  formatPace,
  secondsPerKm,
} from "./index.js";

const now = "2026-06-14T00:00:00.000Z";

function sleep(patch: Partial<HealthSleep> & Pick<HealthSleep, "id" | "date">): HealthSleep {
  return {
    id: patch.id,
    date: patch.date,
    sleepStart: patch.sleepStart ?? "23:30",
    wakeTime: patch.wakeTime ?? "06:45",
    adjustmentHours: patch.adjustmentHours ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

function hrv(patch: Partial<HealthHrv> & Pick<HealthHrv, "id" | "date" | "hrvMs">): HealthHrv {
  return { id: patch.id, date: patch.date, hrvMs: patch.hrvMs, createdAt: now, updatedAt: now };
}

function stress(patch: Partial<HealthStress> & Pick<HealthStress, "id" | "date" | "stress">): HealthStress {
  return { id: patch.id, date: patch.date, stress: patch.stress, createdAt: now, updatedAt: now };
}

function heartRate(patch: Partial<HealthHeartRate> & Pick<HealthHeartRate, "id" | "date">): HealthHeartRate {
  return {
    id: patch.id,
    date: patch.date,
    restingHeartRate: patch.restingHeartRate ?? null,
    minHeartRate: patch.minHeartRate ?? null,
    maxHeartRate: patch.maxHeartRate ?? null,
    avgHeartRate: patch.avgHeartRate ?? null,
    last7DaysAvgRestingHeartRate: patch.last7DaysAvgRestingHeartRate ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function run(patch: Partial<HealthRun> & Pick<HealthRun, "id" | "date" | "startTime">): HealthRun {
  return {
    id: patch.id,
    date: patch.date,
    startTime: patch.startTime,
    distanceKm: patch.distanceKm ?? null,
    durationSeconds: patch.durationSeconds ?? null,
    averageHeartRate: patch.averageHeartRate ?? null,
    averageCadence: patch.averageCadence ?? null,
    averageStrideM: patch.averageStrideM ?? null,
    averageVerticalRatioPercent: patch.averageVerticalRatioPercent ?? null,
    averageVerticalOscillationCm: patch.averageVerticalOscillationCm ?? null,
    averageGroundContactMs: patch.averageGroundContactMs ?? null,
    type: patch.type ?? "running",
    city: patch.city ?? "",
    createdAt: now,
    updatedAt: now,
  };
}

describe("healthMetrics sleep", () => {
  it("计算跨午夜睡眠时长并叠加 adjustmentHours", () => {
    expect(
      computeSleepDurationHours(
        sleep({ id: "s1", date: "2026-06-13", sleepStart: "23:30", wakeTime: "06:45", adjustmentHours: 0.5 }),
      ),
    ).toBe(7.75);
  });
});

describe("healthMetrics format", () => {
  it("计算 secondsPerKm 并格式化为分秒配速", () => {
    expect(secondsPerKm(1500, 5)).toBe(300);
    expect(formatPace(302)).toBe("5'02\"");
    expect(formatPace(null)).toBe("--");
  });
});

describe("healthMetrics range", () => {
  it("按 30 天窗口筛选记录，all 保留全部", () => {
    const records = [
      { id: "old", date: "2026-05-15" },
      { id: "first", date: "2026-05-16" },
      { id: "today", date: "2026-06-14" },
    ];

    expect(filterHealthRecordsByRange(records, "30", "2026-06-14").map((record) => record.id)).toEqual([
      "first",
      "today",
    ]);
    expect(filterHealthRecordsByRange(records, "all", "2026-06-14").map((record) => record.id)).toEqual([
      "old",
      "first",
      "today",
    ]);
  });
});

describe("healthMetrics summary", () => {
  it("汇总睡眠、HRV、压力、静息心率、跑步五项最新指标", () => {
    const summary = buildHealthSummary({
      sleeps: [
        sleep({ id: "s1", date: "2026-06-12", sleepStart: "00:00", wakeTime: "07:00" }),
        sleep({ id: "s2", date: "2026-06-14", sleepStart: "23:00", wakeTime: "06:30", adjustmentHours: 0.5 }),
      ],
      hrvs: [hrv({ id: "h1", date: "2026-06-14", hrvMs: 58 })],
      stresses: [stress({ id: "st1", date: "2026-06-14", stress: 21 })],
      heartRates: [heartRate({ id: "hr1", date: "2026-06-14", restingHeartRate: 62 })],
      runs: [run({ id: "r1", date: "2026-06-14", startTime: "07:00", distanceKm: 5, durationSeconds: 1500 })],
    });

    expect(summary.items.map((item) => item.id)).toEqual(["sleep", "hrv", "stress", "heartRate", "run"]);
    expect(summary.byId.sleep).toMatchObject({ value: 8, formatted: "8.0 h", date: "2026-06-14" });
    expect(summary.byId.hrv).toMatchObject({ value: 58, formatted: "58 ms" });
    expect(summary.byId.stress).toMatchObject({ value: 21, formatted: "21" });
    expect(summary.byId.heartRate).toMatchObject({ value: 62, formatted: "62 bpm" });
    expect(summary.byId.run).toMatchObject({ value: 5, formatted: "5.0 km", secondaryFormatted: "5'00\"" });
  });
});

describe("healthMetrics run trends", () => {
  it("按 date/startTime/id 排序，并用窗口总时长/总距离计算 rolling pace", () => {
    const trend = buildRunPaceTrend([
      run({ id: "d", date: "2026-06-03", startTime: "07:00", distanceKm: 5, durationSeconds: 1500 }),
      run({ id: "b", date: "2026-06-01", startTime: "07:00", distanceKm: 5, durationSeconds: 1800 }),
      run({ id: "a", date: "2026-06-01", startTime: "06:00", distanceKm: 4, durationSeconds: 1200 }),
      run({ id: "c", date: "2026-06-02", startTime: "07:00", distanceKm: 2, durationSeconds: 480 }),
    ]);

    expect(trend.map((point) => point.id)).toEqual(["a", "b", "c", "d"]);
    expect(trend.map((point) => point.paceSecondsPerKm)).toEqual([300, 360, 240, 300]);
    expect(trend[3]).toMatchObject({
      rolling3SecondsPerKm: 315,
      rolling5SecondsPerKm: 311.25,
      rolling10SecondsPerKm: 311.25,
      paceFormatted: "5'00\"",
      rolling3Formatted: "5'15\"",
    });
  });
});

describe("healthMetrics normalized trends", () => {
  it("按日期合并四项健康数据，归一化时保留 raw formatted，缺值为 null", () => {
    const trend = buildNormalizedHealthTrend({
      sleeps: [
        sleep({ id: "s1", date: "2026-06-01", sleepStart: "23:00", wakeTime: "06:00" }),
        sleep({ id: "s2", date: "2026-06-02", sleepStart: "23:00", wakeTime: "07:00" }),
      ],
      hrvs: [hrv({ id: "h1", date: "2026-06-01", hrvMs: 50 })],
      stresses: [
        stress({ id: "st1", date: "2026-06-01", stress: 20 }),
        stress({ id: "st2", date: "2026-06-02", stress: 60 }),
      ],
      heartRates: [heartRate({ id: "hr1", date: "2026-06-02", restingHeartRate: 62 })],
    });

    expect(trend.map((point) => point.date)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(trend[0].sleep).toEqual({ normalized: 0, raw: 7, formatted: "7.0 h" });
    expect(trend[1].sleep).toEqual({ normalized: 100, raw: 8, formatted: "8.0 h" });
    expect(trend[0].hrv).toEqual({ normalized: 50, raw: 50, formatted: "50 ms" });
    expect(trend[1].hrv).toEqual({ normalized: null, raw: null, formatted: null });
    expect(trend[0].stress).toEqual({ normalized: 0, raw: 20, formatted: "20" });
    expect(trend[1].stress).toEqual({ normalized: 100, raw: 60, formatted: "60" });
    expect(trend[0].heartRate).toEqual({ normalized: null, raw: null, formatted: null });
    expect(trend[1].heartRate).toEqual({ normalized: 50, raw: 62, formatted: "62 bpm" });
  });
});
