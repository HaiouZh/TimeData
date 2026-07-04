// @vitest-environment jsdom
import type { ChartBlock as MetricChartBlockConfig } from "@timedata/shared";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../../test/domHarness.js";
import { MetricChartBlock } from "./MetricChartBlock.js";

vi.mock("recharts", () => ({
  Area: () => createElement("span"),
  AreaChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  Bar: () => createElement("span"),
  BarChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  CartesianGrid: () => createElement("span"),
  Legend: () => createElement("span"),
  Line: ({ dataKey, name, yAxisId }: { dataKey?: string; name?: string; yAxisId?: string }) =>
    createElement("span", {
      "data-line": String(dataKey ?? ""),
      "data-name": String(name ?? ""),
      "data-axis": String(yAxisId ?? ""),
    }),
  LineChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  ReferenceLine: ({ y }: { y?: number }) =>
    createElement("span", { "data-refline": "1", "data-refy": String(y ?? "") }),
  ResponsiveContainer: ({ children, height }: { children?: React.ReactNode; height?: number }) =>
    createElement("div", { "data-height": String(height ?? "") }, children),
  Tooltip: () => createElement("span"),
  XAxis: () => createElement("span"),
  YAxis: ({ yAxisId, orientation }: { yAxisId?: string; orientation?: string }) =>
    createElement("span", { "data-yaxis": String(yAxisId ?? ""), "data-orient": String(orientation ?? "") }),
}));

const cfg: MetricChartBlockConfig = {
  id: "c1",
  title: "我的趋势",
  order: 0,
  view: "chart",
  source: "healthMetricDaily",
  metricIds: ["hrv.value"],
  chartKind: "line",
  trendMode: "raw",
  rollingWindows: [],
  showAverageLine: false,
  range: { mode: "inherit" },
  presentation: { exportEnabled: false, colorRules: [], height: 320, yAxis: "auto" },
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

function renderBlock(element: React.ReactElement) {
  return renderDom(element);
}

describe("MetricChartBlock", () => {
  it("渲染标题", async () => {
    const { host, root } = await renderBlock(
      <MetricChartBlock
        config={cfg}
        collections={{
          hrvs: [
            { id: "h1", date: "2026-06-01", hrvMs: 40, createdAt: "x", updatedAt: "x" },
            { id: "h2", date: "2026-06-02", hrvMs: 60, createdAt: "x", updatedAt: "x" },
          ],
        }}
        range={{ mode: "all" }}
      />,
    );

    expect(host.textContent).toContain("我的趋势");
    expect(host.querySelector("[data-height]")?.getAttribute("data-height")).toBe("320");
    await unmount(root);
  });

  it("无数据显示空态", async () => {
    const { host, root } = await renderBlock(
      <MetricChartBlock config={cfg} collections={{}} range={{ mode: "all" }} />,
    );

    expect(host.textContent).toContain("暂无数据");
    await unmount(root);
  });

  it("勾选滚动窗时渲染滚动均线", async () => {
    const rollingCfg: MetricChartBlockConfig = { ...cfg, rollingWindows: [7] };
    const { host, root } = await renderBlock(
      <MetricChartBlock
        config={rollingCfg}
        collections={{
          hrvs: [
            { id: "h1", date: "2026-06-01", hrvMs: 40, createdAt: "x", updatedAt: "x" },
            { id: "h2", date: "2026-06-02", hrvMs: 60, createdAt: "x", updatedAt: "x" },
          ],
        }}
        range={{ mode: "all" }}
      />,
    );

    const lineKeys = [...host.querySelectorAll("[data-line]")].map((el) => el.getAttribute("data-line"));
    expect(lineKeys).toContain("hrv.value");
    expect(lineKeys).toContain("hrv.value:rolling:7");
    await unmount(root);
  });

  it("两个异口径指标 → 双轴（左右两轴 + 序列各自 yAxisId）", async () => {
    const dualCfg: MetricChartBlockConfig = { ...cfg, metricIds: ["hrv.value", "stress.value"], trendMode: "auto" };
    const { host, root } = await renderBlock(
      <MetricChartBlock
        config={dualCfg}
        collections={{
          hrvs: [
            { id: "h1", date: "2026-06-01", hrvMs: 40, createdAt: "x", updatedAt: "x" },
            { id: "h2", date: "2026-06-02", hrvMs: 60, createdAt: "x", updatedAt: "x" },
          ],
          stresses: [
            { id: "s1", date: "2026-06-01", stress: 30, createdAt: "x", updatedAt: "x" },
            { id: "s2", date: "2026-06-02", stress: 45, createdAt: "x", updatedAt: "x" },
          ],
        }}
        range={{ mode: "all" }}
      />,
    );
    const axes = [...host.querySelectorAll("[data-yaxis]")];
    expect(axes.length).toBe(2);
    expect(axes.some((el) => el.getAttribute("data-orient") === "right")).toBe(true);
    const lineAxes = [...host.querySelectorAll("[data-line]")].map((el) => el.getAttribute("data-axis"));
    expect(lineAxes).toContain("y");
    expect(lineAxes).toContain("y1");
    expect(host.textContent).toContain("双轴");
    await unmount(root);
  });

  it("≥3 异口径指标 → 指数化（角标 + 基期参考线）", async () => {
    const indexCfg: MetricChartBlockConfig = {
      ...cfg,
      metricIds: ["hrv.value", "stress.value", "heart_rate.resting"],
      trendMode: "auto",
    };
    const { host, root } = await renderBlock(
      <MetricChartBlock
        config={indexCfg}
        collections={{
          hrvs: [
            { id: "h1", date: "2026-06-01", hrvMs: 40, createdAt: "x", updatedAt: "x" },
            { id: "h2", date: "2026-06-02", hrvMs: 60, createdAt: "x", updatedAt: "x" },
          ],
          stresses: [
            { id: "s1", date: "2026-06-01", stress: 30, createdAt: "x", updatedAt: "x" },
            { id: "s2", date: "2026-06-02", stress: 45, createdAt: "x", updatedAt: "x" },
          ],
          heartRates: [
            {
              id: "r1",
              date: "2026-06-01",
              restingHeartRate: 55,
              minHeartRate: null,
              maxHeartRate: null,
              avgHeartRate: null,
              last7DaysAvgRestingHeartRate: null,
              createdAt: "x",
              updatedAt: "x",
            },
            {
              id: "r2",
              date: "2026-06-02",
              restingHeartRate: 58,
              minHeartRate: null,
              maxHeartRate: null,
              avgHeartRate: null,
              last7DaysAvgRestingHeartRate: null,
              createdAt: "x",
              updatedAt: "x",
            },
          ],
        }}
        range={{ mode: "all" }}
      />,
    );
    expect(host.textContent).toContain("指数化");
    const refY = [...host.querySelectorAll("[data-refline]")].map((el) => el.getAttribute("data-refy"));
    expect(refY).toContain("100");
    await unmount(root);
  });

  it("同口径多指标(3×bpm) → 单轴，不指数化", async () => {
    const sameCfg: MetricChartBlockConfig = {
      ...cfg,
      metricIds: ["heart_rate.resting", "heart_rate.min", "heart_rate.max"],
      trendMode: "auto",
    };
    const { host, root } = await renderBlock(
      <MetricChartBlock
        config={sameCfg}
        collections={{
          heartRates: [
            {
              id: "r1",
              date: "2026-06-01",
              restingHeartRate: 55,
              minHeartRate: 48,
              maxHeartRate: 120,
              avgHeartRate: null,
              last7DaysAvgRestingHeartRate: null,
              createdAt: "x",
              updatedAt: "x",
            },
            {
              id: "r2",
              date: "2026-06-02",
              restingHeartRate: 58,
              minHeartRate: 50,
              maxHeartRate: 130,
              avgHeartRate: null,
              last7DaysAvgRestingHeartRate: null,
              createdAt: "x",
              updatedAt: "x",
            },
          ],
        }}
        range={{ mode: "all" }}
      />,
    );
    const axes = [...host.querySelectorAll("[data-yaxis]")];
    expect(axes.length).toBe(1);
    expect(host.textContent).not.toContain("指数化");
    await unmount(root);
  });
});
