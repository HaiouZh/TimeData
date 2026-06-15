// @vitest-environment jsdom
import type { ChartBlock as MetricChartBlockConfig } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MetricChartBlock } from "./MetricChartBlock.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("recharts", () => ({
  Area: () => createElement("span"),
  AreaChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  Bar: () => createElement("span"),
  BarChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  CartesianGrid: () => createElement("span"),
  Legend: () => createElement("span"),
  Line: () => createElement("span"),
  LineChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  ReferenceLine: () => createElement("span"),
  ResponsiveContainer: ({ children, height }: { children?: React.ReactNode; height?: number }) =>
    createElement("div", { "data-height": String(height ?? "") }, children),
  Tooltip: () => createElement("span"),
  XAxis: () => createElement("span"),
  YAxis: () => createElement("span"),
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
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return { host, root };
}

describe("MetricChartBlock", () => {
  it("渲染标题", () => {
    const { host, root } = renderBlock(
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
    act(() => root.unmount());
  });

  it("无数据显示空态", () => {
    const { host, root } = renderBlock(<MetricChartBlock config={cfg} collections={{}} range={{ mode: "all" }} />);

    expect(host.textContent).toContain("暂无数据");
    act(() => root.unmount());
  });
});
