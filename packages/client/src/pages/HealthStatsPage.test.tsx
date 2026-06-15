// @vitest-environment jsdom
import type { HealthChartConfig, HealthHeartRate, HealthHrv, HealthRun, HealthSleep, HealthStress } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HealthStatsPage from "./HealthStatsPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StoreName = "healthHeartRate" | "healthHrv" | "healthSleep" | "healthStress" | "runs";

const now = "2026-06-14T00:00:00.000Z";

const healthState = vi.hoisted(() => ({
  healthHeartRate: [] as HealthHeartRate[],
  healthHrv: [] as HealthHrv[],
  healthSleep: [] as HealthSleep[],
  healthStress: [] as HealthStress[],
  runs: [] as HealthRun[],
}));

const chartState = vi.hoisted(() => ({
  blocks: [] as HealthChartConfig[],
  seeded: false,
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));

vi.mock("../db/index.ts", () => ({
  db: {
    healthHeartRate: createStore("healthHeartRate"),
    healthHrv: createStore("healthHrv"),
    healthSleep: createStore("healthSleep"),
    healthStress: createStore("healthStress"),
    runs: createStore("runs"),
  },
}));

vi.mock("../lib/settings/index.ts", () => ({
  useSetting: () => null,
}));

vi.mock("../lib/healthCharts.ts", () => ({
  listHealthChartBlocks: () => [...chartState.blocks].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
  putHealthChartBlock: async (input: Omit<HealthChartConfig, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string }) => {
    const block = {
      ...input,
      id: input.id ?? `chart-${chartState.blocks.length + 1}`,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    } as HealthChartConfig;
    chartState.blocks = [...chartState.blocks.filter((item) => item.id !== block.id), block];
    return block;
  },
  deleteHealthChartBlock: async (id: string) => {
    chartState.blocks = chartState.blocks.filter((item) => item.id !== id);
  },
  seedDefaultHealthChartsOnce: async () => {
    if (chartState.seeded) return;
    chartState.seeded = true;
    chartState.blocks = [
      { id: "summary", type: "summary", order: 0, title: "健康摘要", createdAt: now, updatedAt: now },
      {
        id: "trend",
        type: "metricChart",
        order: 1,
        title: "健康趋势",
        metricIds: ["sleep.duration", "hrv.value", "stress.value", "heart_rate.resting"],
        chartKind: "line",
        trendMode: "auto",
        rollingWindows: [7],
        showAverageLine: false,
        createdAt: now,
        updatedAt: now,
      },
      { id: "run", type: "runTrend", order: 2, title: "跑步配速", createdAt: now, updatedAt: now },
    ];
  },
}));

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
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  Tooltip: () => createElement("span"),
  XAxis: () => createElement("span"),
  YAxis: () => createElement("span"),
}));

function createStore(name: StoreName) {
  return {
    orderBy: () => ({
      toArray: () => [...healthState[name]].sort((a, b) => a.date.localeCompare(b.date)),
    }),
  };
}

async function renderPage() {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(HealthStatsPage));
  });
  return { host, root };
}

async function waitForCondition(assertion: () => boolean, message: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (assertion()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(message);
}

function seedHealthData() {
  healthState.healthSleep = [
    { id: "s1", date: "2026-06-13", sleepStart: "23:00", wakeTime: "06:00", adjustmentHours: 0, createdAt: now, updatedAt: now },
  ];
  healthState.healthHrv = [{ id: "h1", date: "2026-06-13", hrvMs: 45, createdAt: now, updatedAt: now }];
  healthState.healthStress = [{ id: "st1", date: "2026-06-13", stress: 30, createdAt: now, updatedAt: now }];
  healthState.healthHeartRate = [
    {
      id: "hr1",
      date: "2026-06-13",
      restingHeartRate: 58,
      minHeartRate: null,
      maxHeartRate: null,
      avgHeartRate: null,
      last7DaysAvgRestingHeartRate: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  healthState.runs = [
    {
      id: "r1",
      date: "2026-06-13",
      startTime: "07:00",
      distanceKm: 5,
      durationSeconds: 1800,
      averageHeartRate: 140,
      averageCadence: 172,
      averageStrideM: 1.12,
      averageVerticalRatioPercent: 7.8,
      averageVerticalOscillationCm: 8.4,
      averageGroundContactMs: 230,
      type: "running",
      city: "赣州",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

describe("HealthStatsPage", () => {
  beforeEach(() => {
    healthState.healthHeartRate = [];
    healthState.healthHrv = [];
    healthState.healthSleep = [];
    healthState.healthStress = [];
    healthState.runs = [];
    chartState.blocks = [];
    chartState.seeded = false;
  });

  it("renders health summary, trend panels, and recent runs", async () => {
    seedHealthData();
    const { host, root } = await renderPage();

    await waitForCondition(() => host.textContent?.includes("健康摘要") ?? false, "Timed out waiting for health blocks");

    expect(host.textContent).toContain("健康统计");
    expect(host.querySelector('[aria-label="健康摘要"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="健康趋势"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="跑步配速趋势"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="最近跑步"]')).not.toBeNull();
    expect(host.textContent).toContain("7.0h");
    expect(host.textContent).toContain("赣州");

    await act(async () => root.unmount());
  });

  it("switches the health range", async () => {
    seedHealthData();
    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelectorAll(".health-range-button").length >= 3, "Timed out waiting for range buttons");
    const ninetyDays = [...host.querySelectorAll(".health-range-button")].find((button) => button.textContent === "90天");

    await act(async () => {
      ninetyDays?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("90天");
    await act(async () => root.unmount());
  });

  it("renders an empty state without health data", async () => {
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("暂无健康数据");
    await act(async () => root.unmount());
  });

  it("expands recent run details", async () => {
    seedHealthData();
    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelector(".health-run-summary") != null, "Timed out waiting for recent run");

    await act(async () => {
      host.querySelector(".health-run-summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("开始时间");
    expect(host.textContent).toContain("步频");
    expect(host.textContent).toContain("running");
    await act(async () => root.unmount());
  });

  it("挂载后注入预置块并渲染", async () => {
    seedHealthData();
    const { host, root } = await renderPage();

    await waitForCondition(() => host.textContent?.includes("健康摘要") ?? false, "Timed out waiting for seeded health blocks");

    expect(host.textContent).toContain("健康摘要");
    expect(host.textContent).toContain("健康趋势");
    expect(host.textContent).toContain("跑步配速");

    await act(async () => root.unmount());
  });

  it("点击右上角＋打开搭建器", async () => {
    seedHealthData();
    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelector('[aria-label="添加图表"]') != null, "Timed out waiting for add chart button");

    await act(async () => {
      host.querySelector('[aria-label="添加图表"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("重新打开搭建器时按当前编辑对象重置表单", async () => {
    seedHealthData();
    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelector('[aria-label="编辑图表"]') != null, "Timed out waiting for metricChart edit button");

    // 打开“新增”，勾一个预置趋势块没有的指标，污染弹窗内部状态
    await act(async () => {
      host.querySelector('[aria-label="添加图表"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector('input[aria-label="最高心率"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((host.querySelector('input[aria-label="最高心率"]') as HTMLInputElement).checked).toBe(true);

    // 取消后转去编辑预置 metricChart 块
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "取消")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector('[aria-label="编辑图表"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 弹窗应反映被编辑块的指标，而不是上一次“新增”的残留
    expect((host.querySelector('input[aria-label="睡眠时长"]') as HTMLInputElement).checked).toBe(true);
    expect((host.querySelector('input[aria-label="最高心率"]') as HTMLInputElement).checked).toBe(false);

    await act(async () => root.unmount());
  });
});
