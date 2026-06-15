import { describe, expect, it } from "vitest";
import type { HealthChartConfig } from "@timedata/shared";
import { healthChartToRow, rowToHealthChart, type HealthChartRow } from "./chartRows.js";

const block: HealthChartConfig = {
  id: "c1",
  type: "metricChart",
  order: 2,
  title: "趋势",
  metricIds: ["hrv.value"],
  chartKind: "line",
  trendMode: "auto",
  rollingWindows: [7],
  showAverageLine: false,
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

describe("chartRows", () => {
  it("toRow 摊平 + config JSON", () => {
    const row = healthChartToRow(block);
    expect(row).toMatchObject({ id: "c1", type: "metricChart", sort_order: 2, created_at: block.createdAt });
    expect(JSON.parse(String(row.config)).metricIds).toEqual(["hrv.value"]);
  });

  it("rowToHealthChart 还原配置", () => {
    const row = healthChartToRow(block) as unknown as HealthChartRow;
    const restored = rowToHealthChart({ ...row, updated_at: block.updatedAt });
    expect(restored).toEqual(block);
  });
});
