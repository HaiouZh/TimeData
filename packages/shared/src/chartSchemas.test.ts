import { describe, expect, it } from "vitest";
import { HealthChartConfigSchema } from "./chartSchemas.js";

const base = {
  id: "c1",
  title: "健康趋势",
  order: 0,
  range: { mode: "inherit" },
  presentation: { exportEnabled: false, colorRules: [], yAxis: "auto" },
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

describe("HealthChartConfigSchema", () => {
  it("accepts a chart block", () => {
    const parsed = HealthChartConfigSchema.parse({
      ...base,
      view: "chart",
      source: "healthMetricDaily",
      metricIds: ["sleep.duration", "hrv.value"],
      chartKind: "line",
      trendMode: "auto",
      rollingWindows: [7],
      showAverageLine: false,
    });

    expect(parsed.view).toBe("chart");
    expect(parsed.source).toBe("healthMetricDaily");
  });

  it("accepts stat and table blocks", () => {
    expect(HealthChartConfigSchema.parse({ ...base, view: "stat", source: "derived", metricIds: ["sleep.duration"] }).view).toBe(
      "stat",
    );
    expect(
      HealthChartConfigSchema.parse({
        ...base,
        view: "table",
        source: "runs",
        columnIds: ["date", "distanceKm", "pace"],
        rollingWindows: [],
        showRawColumns: true,
        showRollingColumns: false,
        hideEmptyRows: false,
        maxRows: 20,
        presentation: { exportEnabled: true, colorRules: [], yAxis: "auto" },
      }).view,
    ).toBe("table");
  });

  it("stat block aggregation 可选且只接受合法枚举", () => {
    expect(
      HealthChartConfigSchema.parse({ ...base, view: "stat", source: "derived", metricIds: ["sleep.duration"] }).view,
    ).toBe("stat");
    expect(
      HealthChartConfigSchema.parse({
        ...base,
        view: "stat",
        source: "derived",
        metricIds: ["sleep.duration"],
        aggregation: "avg",
      }),
    ).toMatchObject({ aggregation: "avg" });
    expect(
      HealthChartConfigSchema.safeParse({
        ...base,
        view: "stat",
        source: "derived",
        metricIds: ["sleep.duration"],
        aggregation: "median",
      }).success,
    ).toBe(false);
  });

  it("validates ranges and presentation compatibility fields", () => {
    expect(
      HealthChartConfigSchema.safeParse({
        ...base,
        view: "stat",
        source: "derived",
        metricIds: ["sleep.duration"],
        range: { mode: "recent", days: 0 },
      }).success,
    ).toBe(false);
    expect(
      HealthChartConfigSchema.safeParse({
        ...base,
        view: "stat",
        source: "derived",
        metricIds: ["sleep.duration"],
        range: { mode: "manual", from: "2026-06-16", to: "2026-06-15" },
      }).success,
    ).toBe(false);
    expect(
      HealthChartConfigSchema.safeParse({
        ...base,
        view: "stat",
        source: "derived",
        metricIds: ["sleep.duration"],
        presentation: { colorRules: [{ fieldId: "sleep.duration", operator: "between", value: 8, tone: "good" }] },
      }).success,
    ).toBe(false);
  });

  it("rejects old type-based blocks", () => {
    expect(HealthChartConfigSchema.safeParse({ ...base, type: "metricChart", metricIds: ["hrv.value"] }).success).toBe(false);
  });
});
