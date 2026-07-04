// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import {
  CategoryCompositionBars,
  CategoryDonut,
  type CompositionParent,
  type DonutDatum,
  TrendChart,
} from "./InsightCharts.tsx";

const rechartsMockState = vi.hoisted(() => ({
  yAxisProps: [] as Array<{ domain?: unknown; ticks?: unknown }>,
}));

vi.mock("recharts", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    Area: () => createElement("span"),
    AreaChart: Wrapper,
    CartesianGrid: () => createElement("span"),
    Cell: () => createElement("span"),
    Legend: () => createElement("span"),
    Line: () => createElement("span"),
    LineChart: Wrapper,
    Pie: Wrapper,
    PieChart: Wrapper,
    ResponsiveContainer: Wrapper,
    Tooltip: () => createElement("span"),
    XAxis: () => createElement("span"),
    YAxis: (props: { domain?: unknown; ticks?: unknown }) => {
      rechartsMockState.yAxisProps.push(props);
      return createElement("span");
    },
  };
});

beforeEach(() => {
  rechartsMockState.yAxisProps = [];
});

const sampleParents: CompositionParent[] = [
  {
    id: "work",
    name: "工作",
    totalHours: 3,
    sharePct: 60,
    color: "#3b82f6",
    children: [
      { id: "coding", name: "编码", min: 120, color: "#60a5fa" },
      { id: "meeting", name: "会议", min: 60, color: "#93c5fd" },
    ],
  },
];

describe("CategoryCompositionBars", () => {
  it("展示父分类汇总，点击后展开子分类明细", async () => {
    const { host, root } = await renderDom(createElement(CategoryCompositionBars, { parents: sampleParents }));

    expect(host.textContent).toContain("工作");
    expect(host.textContent).toContain("3.0h · 60%");
    expect(host.textContent).not.toContain("编码");

    const header = host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement | null;
    await act(async () => {
      header?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("编码");
    expect(host.textContent).toContain("2.0h");

    await unmount(root);
  });
});

describe("TrendChart", () => {
  it("把固定 Y 轴 domain 和 ticks 传给 Recharts YAxis", async () => {
    const { root } = await renderDom(
      createElement(TrendChart, {
        chart: "area",
        data: [{ date: "06-01", 工作: 24 }],
        series: [{ key: "工作", color: "#3b82f6" }],
        yAxisDomain: [0, 24],
        yAxisTicks: [0, 6, 12, 18, 24],
      }),
    );

    expect(rechartsMockState.yAxisProps).toHaveLength(1);
    expect(rechartsMockState.yAxisProps[0]?.domain).toEqual([0, 24]);
    expect(rechartsMockState.yAxisProps[0]?.ticks).toEqual([0, 6, 12, 18, 24]);

    await unmount(root);
  });
});

const donutData: DonutDatum[] = [
  { id: "work", name: "工作", value: 3, color: "#3b82f6" },
  { id: "rest", name: "休息", value: 1, color: "#22c55e" },
];

describe("CategoryDonut", () => {
  it("中央展示总时长与覆盖率", async () => {
    const { host, root } = await renderDom(
      createElement(CategoryDonut, {
        data: donutData,
        totalHours: 4,
        coveragePct: 80,
        coverageNote: null,
      }),
    );

    expect(host.textContent).toContain("4.0h");
    expect(host.textContent).toContain("覆盖率 80.0%");

    await unmount(root);
  });
});
