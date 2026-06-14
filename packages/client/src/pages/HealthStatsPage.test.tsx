// @vitest-environment jsdom
import type { HealthHeartRate, HealthHrv, HealthRun, HealthSleep, HealthStress } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HealthStatsPage from "./HealthStatsPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StoreName = "healthHeartRate" | "healthHrv" | "healthSleep" | "healthStress" | "runs";

const healthState = vi.hoisted(() => ({
  healthHeartRate: [] as HealthHeartRate[],
  healthHrv: [] as HealthHrv[],
  healthSleep: [] as HealthSleep[],
  healthStress: [] as HealthStress[],
  runs: [] as HealthRun[],
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

vi.mock("recharts", () => ({
  CartesianGrid: () => createElement("span"),
  Legend: () => createElement("span"),
  Line: () => createElement("span"),
  LineChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
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

function renderPage() {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(createElement(HealthStatsPage));
  });
  return { host, root };
}

const now = "2026-06-14T00:00:00.000Z";

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
  });

  it("renders health summary, trend panels, and recent runs", () => {
    seedHealthData();
    const { host, root } = renderPage();

    expect(host.textContent).toContain("健康统计");
    expect(host.querySelector('[aria-label="健康摘要"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="健康趋势"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="跑步配速趋势"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="最近跑步"]')).not.toBeNull();
    expect(host.textContent).toContain("7.0h");
    expect(host.textContent).toContain("赣州");

    act(() => root.unmount());
  });

  it("switches the health range", () => {
    seedHealthData();
    const { host, root } = renderPage();
    const ninetyDays = host.querySelector('button[aria-pressed="false"]');

    act(() => {
      ninetyDays?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("90天");
    act(() => root.unmount());
  });

  it("renders an empty state without health data", () => {
    const { host, root } = renderPage();

    expect(host.textContent).toContain("暂无健康数据");
    expect(host.querySelector('[aria-label="健康摘要"]')).toBeNull();

    act(() => root.unmount());
  });

  it("expands recent run details", () => {
    seedHealthData();
    const { host, root } = renderPage();

    act(() => {
      host.querySelector(".health-run-summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("开始时间");
    expect(host.textContent).toContain("步频");
    expect(host.textContent).toContain("running");
    act(() => root.unmount());
  });
});
