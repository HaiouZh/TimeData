import type { MetricPoint } from "./types.js";
import { describe, expect, it } from "vitest";
import { aggregateMetricPoints } from "./aggregate.js";

function pt(date: string, value: number | null): MetricPoint {
  return { date, value, formattedValue: "", rolling: {}, formattedRolling: {} };
}

describe("aggregateMetricPoints", () => {
  const points = [pt("2026-06-01", 40), pt("2026-06-02", null), pt("2026-06-03", 60), pt("2026-06-04", 50)];

  it("latest 取最后一个非空点及其日期", () => {
    expect(aggregateMetricPoints(points, "latest")).toEqual({ value: 50, date: "2026-06-04" });
  });

  it("avg 取非空均值，日期为 null", () => {
    expect(aggregateMetricPoints(points, "avg")).toEqual({ value: 50, date: null });
  });

  it("sum 取非空求和，日期为 null", () => {
    expect(aggregateMetricPoints(points, "sum")).toEqual({ value: 150, date: null });
  });

  it("max 取最大值及其发生日期", () => {
    expect(aggregateMetricPoints(points, "max")).toEqual({ value: 60, date: "2026-06-03" });
  });

  it("min 取最小值及其发生日期", () => {
    expect(aggregateMetricPoints(points, "min")).toEqual({ value: 40, date: "2026-06-01" });
  });

  it("全为空返回 value=null date=null", () => {
    expect(aggregateMetricPoints([pt("2026-06-01", null)], "latest")).toEqual({ value: null, date: null });
    expect(aggregateMetricPoints([], "avg")).toEqual({ value: null, date: null });
  });
});
