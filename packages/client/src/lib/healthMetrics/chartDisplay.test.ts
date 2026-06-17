import { describe, expect, it } from "vitest";
import { buildChartRows, rollingKey } from "./chartDisplay.js";
import type { MetricSeries } from "./types.js";

function series(
  metricId: string,
  points: Array<{ date: string; value: number | null; rolling?: Record<string, number | null> }>,
): MetricSeries {
  return {
    metricId,
    label: metricId,
    unit: "",
    valueType: "number",
    points: points.map((point) => ({
      date: point.date,
      value: point.value,
      formattedValue: point.value == null ? "--" : String(point.value),
      rolling: point.rolling ?? {},
      formattedRolling: {},
    })),
  };
}

describe("rollingKey", () => {
  it("拼出滚动列键", () => {
    expect(rollingKey("hrv.value", 7)).toBe("hrv.value:rolling:7");
  });
});

describe("buildChartRows", () => {
  it("原始模式：原值与滚动键都进 row", () => {
    const s = series("hrv.value", [
      { date: "2026-06-01", value: 40, rolling: { "7": 40 } },
      { date: "2026-06-02", value: 60, rolling: { "7": 50 } },
    ]);
    const { dates, rows } = buildChartRows([s], { normalized: false, rollingWindows: [7] });
    expect(dates).toEqual(["2026-06-01", "2026-06-02"]);
    expect(rows[0]).toEqual({ date: "2026-06-01", "hrv.value": 40, "hrv.value:rolling:7": 40 });
    expect(rows[1]).toEqual({ date: "2026-06-02", "hrv.value": 60, "hrv.value:rolling:7": 50 });
  });

  it("归一化模式：原值与滚动用同一 min/max 基准映射 0-100", () => {
    const s = series("hrv.value", [
      { date: "2026-06-01", value: 40, rolling: { "7": 40 } },
      { date: "2026-06-02", value: 60, rolling: { "7": 50 } },
    ]);
    const { rows } = buildChartRows([s], { normalized: true, rollingWindows: [7] });
    expect(rows[0]["hrv.value"]).toBe(0);
    expect(rows[1]["hrv.value"]).toBe(100);
    expect(rows[0]["hrv.value:rolling:7"]).toBe(0);
    expect(rows[1]["hrv.value:rolling:7"]).toBe(50);
  });

  it("无滚动窗时不产生滚动键", () => {
    const s = series("hrv.value", [{ date: "2026-06-01", value: 40 }]);
    const { rows } = buildChartRows([s], { normalized: false, rollingWindows: [] });
    expect(rows[0]).toEqual({ date: "2026-06-01", "hrv.value": 40 });
  });
});
