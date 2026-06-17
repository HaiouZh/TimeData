import type { HealthHrv, HealthRun } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { formatMetricValue, getChartSeries } from "./chartSeries.js";
import { getMetricDef } from "./registry.js";

function hrv(date: string, value: number): HealthHrv {
  return {
    id: `hrv-${date}`,
    date,
    hrvMs: value,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function run(date: string, distanceKm: number, durationSeconds: number): HealthRun {
  return {
    id: `run-${date}`,
    date,
    startTime: "08:00",
    distanceKm,
    durationSeconds,
    averageHeartRate: null,
    averageCadence: null,
    averageStrideM: null,
    averageVerticalRatioPercent: null,
    averageVerticalOscillationCm: null,
    averageGroundContactMs: null,
    type: "",
    city: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("formatMetricValue", () => {
  it("覆盖 number / time / pace 三型与 null", () => {
    expect(formatMetricValue(getMetricDef("hrv.value"), 45)).toBe("45 ms");
    expect(formatMetricValue(getMetricDef("sleep.wake"), 7.5)).toBe("07:30");
    expect(formatMetricValue(getMetricDef("run.pace"), 330)).toBe("5'30\"/km");
    expect(formatMetricValue(getMetricDef("hrv.value"), null)).toBe("--");
  });
});

describe("getChartSeries", () => {
  it("单指标产出按日期排序的点与 from/to", () => {
    const result = getChartSeries(
      { metricIds: ["hrv.value"], rollingWindows: [], range: { mode: "all" } },
      { hrvs: [hrv("2026-06-03", 50), hrv("2026-06-01", 40)] },
    );
    expect(result.from).toBe("2026-06-01");
    expect(result.to).toBe("2026-06-03");
    expect(result.series).toHaveLength(1);
    expect(result.series[0].points.map((point) => point.value)).toEqual([40, null, 50]);
  });

  it("number rolling 取最近 N 个有效值均值", () => {
    const result = getChartSeries(
      { metricIds: ["hrv.value"], rollingWindows: [2], range: { mode: "all" } },
      { hrvs: [hrv("2026-06-01", 40), hrv("2026-06-02", 60), hrv("2026-06-03", 80)] },
    );
    const rolling = result.series[0].points.map((point) => point.rolling["2"]);
    expect(rolling[0]).toBeCloseTo(40, 5);
    expect(rolling[1]).toBeCloseTo(50, 5);
    expect(rolling[2]).toBeCloseTo(70, 5);
  });

  it("pace rolling 用窗口内总时长/总距离", () => {
    const result = getChartSeries(
      { metricIds: ["run.pace"], rollingWindows: [2], range: { mode: "all" } },
      { runs: [run("2026-06-01", 5, 1500), run("2026-06-02", 5, 1800)] },
    );
    const rolling = result.series[0].points.map((point) => point.rolling["2"]);
    // 第二点窗口：(1500+1800)/(5+5)=330
    expect(rolling[1]).toBeCloseTo(330, 5);
  });

  it("recent days 截取最近 N 天", () => {
    const result = getChartSeries(
      { metricIds: ["hrv.value"], rollingWindows: [], range: { mode: "recent", days: 2 } },
      { hrvs: [hrv("2026-06-01", 40), hrv("2026-06-02", 50), hrv("2026-06-03", 60)] },
    );
    // 以数据最大日 2026-06-03 为锚，最近 2 天 => 06-02、06-03
    expect(result.series[0].points.map((point) => point.date)).toEqual(["2026-06-02", "2026-06-03"]);
  });

  it("manual 范围按 from/to 过滤", () => {
    const result = getChartSeries(
      { metricIds: ["hrv.value"], rollingWindows: [], range: { mode: "manual", from: "2026-06-02", to: "2026-06-02" } },
      { hrvs: [hrv("2026-06-01", 40), hrv("2026-06-02", 50), hrv("2026-06-03", 60)] },
    );
    expect(result.series[0].points.map((point) => point.date)).toEqual(["2026-06-02"]);
  });

  it("time 指标 formattedValue 是时钟", () => {
    const result = getChartSeries(
      { metricIds: ["sleep.wake"], rollingWindows: [], range: { mode: "all" } },
      {
        sleeps: [
          {
            id: "s1",
            date: "2026-06-01",
            sleepStart: "23:00",
            wakeTime: "07:30",
            adjustmentHours: 0,
            createdAt: "x",
            updatedAt: "x",
          },
        ],
      },
    );
    expect(result.series[0].points[0].formattedValue).toBe("07:30");
  });

  it("空数据返回空 series 与空 from/to", () => {
    const result = getChartSeries({ metricIds: ["hrv.value"], rollingWindows: [], range: { mode: "all" } }, {});
    expect(result.series[0].points).toHaveLength(0);
    expect(result.from).toBe("");
    expect(result.to).toBe("");
  });
});
