import { describe, expect, it } from "vitest";
import { HealthChartConfigSchema } from "./chartSchemas.js";

const base = {
  id: "c1",
  order: 0,
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

describe("HealthChartConfigSchema", () => {
  it("接受合法 metricChart", () => {
    const parsed = HealthChartConfigSchema.parse({
      ...base,
      type: "metricChart",
      title: "趋势",
      metricIds: ["hrv.value"],
      chartKind: "line",
      trendMode: "auto",
      rollingWindows: [7],
      showAverageLine: false,
    });

    expect(parsed.type).toBe("metricChart");
  });

  it("接受 runTrend / summary", () => {
    expect(HealthChartConfigSchema.parse({ ...base, type: "runTrend", title: "跑步" }).type).toBe("runTrend");
    expect(HealthChartConfigSchema.parse({ ...base, type: "summary", title: "摘要" }).type).toBe("summary");
  });

  it("metricChart 至少一个指标", () => {
    const result = HealthChartConfigSchema.safeParse({
      ...base,
      type: "metricChart",
      title: "x",
      metricIds: [],
      chartKind: "line",
      trendMode: "auto",
      rollingWindows: [],
      showAverageLine: false,
    });

    expect(result.success).toBe(false);
  });

  it("拒绝未知 type", () => {
    expect(HealthChartConfigSchema.safeParse({ ...base, type: "pie", title: "x" }).success).toBe(false);
  });
});
