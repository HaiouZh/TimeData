// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/index.ts";
import { getSetting } from "../../../lib/settings/index.ts";
import TrendSection, { buildTrendChartRows } from "./TrendSection.tsx";
import { makeStatsProps } from "./testFixtures.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trendChartMockState = vi.hoisted(() => ({
  props: [] as Array<{
    chart: string;
    yAxisDomain?: unknown;
    yAxisTicks?: unknown;
  }>,
}));

vi.mock("../InsightCharts.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../InsightCharts.tsx")>();
  return {
    ...actual,
    TrendChart: (props: { chart: string; yAxisDomain?: unknown; yAxisTicks?: unknown }) => {
      trendChartMockState.props.push(props);
      return createElement("div", { "data-testid": "trend-chart" });
    },
  };
});

beforeEach(async () => {
  trendChartMockState.props = [];
  await db.settings.clear();
  await db.syncLog.clear();
});

async function waitForSetting(key: string, expected: (raw: string | null) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const raw = await getSetting(key);
    if (expected(raw)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${key}`);
}

function category(id: string) {
  return {
    id,
    name: id,
    parentId: null,
    color: "#3b82f6",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function entry(id: string, categoryId: string, startTime: string, endTime: string) {
  return {
    id,
    categoryId,
    startTime,
    endTime,
    note: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

describe("TrendSection", () => {
  it("趋势图行数据保留原始小时精度，避免分类先四舍五入后堆叠超过 24h", () => {
    const parentTrends = ["a", "b", "c", "d", "e", "f", "g"].map((parentId) => ({
      parentId,
      currentMin: parentId === "g" ? 702 : 123,
      previousMin: 0,
      deltaPct: null,
      state: "noBaseline" as const,
    }));
    const rows = buildTrendChartRows(
      [
        {
          date: "2026-06-01",
          byParent: {
            a: 123,
            b: 123,
            c: 123,
            d: 123,
            e: 123,
            f: 123,
            g: 702,
          },
        },
      ],
      parentTrends,
      new Map([
        ["a", "A"],
        ["b", "B"],
        ["c", "C"],
        ["d", "D"],
        ["e", "E"],
        ["f", "F"],
        ["g", "G"],
      ]),
    );

    const row = rows[0];
    const stackedHours = ["A", "B", "C", "D", "E", "F", "G"].reduce(
      (sum, key) => sum + Number(row[key]),
      0,
    );

    expect(stackedHours).toBeCloseTo(24, 8);
    expect(row.A).toBeCloseTo(123 / 60, 8);
    expect(row.G).toBeCloseTo(702 / 60, 8);
  });

  it("点击近30天后写入 stats.module.trend.v1", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(TrendSection, makeStatsProps()));
    });

    const preset30 = [...host.querySelectorAll("button")].find((button) => button.textContent === "近30天");
    await act(async () => {
      preset30?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForSetting("stats.module.trend.v1", (raw) => raw?.includes('"days":30') ?? false);

    await act(async () => {
      root.unmount();
    });
  });

  it("堆叠面积图固定使用 0 到 24h 的 Y 轴", async () => {
    await db.settings.put({
      key: "stats.module.trend.v1",
      value: JSON.stringify({ window: { kind: "preset", days: 7 }, chart: "area" }),
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    const work = category("work");
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(
        createElement(
          TrendSection,
          makeStatsProps({
            categories: [work],
            parentCategories: [work],
            parentNameById: new Map([["work", "工作"]]),
            baselineEntries: [
              entry("work-1", "work", "2026-06-01T01:00:00.000Z", "2026-06-01T03:00:00.000Z"),
            ],
          }),
        ),
      );
    });

    const startedAt = Date.now();
    while (
      Date.now() - startedAt < 1000 &&
      !trendChartMockState.props.some((props) => props.chart === "area")
    ) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }

    const areaProps = trendChartMockState.props.find((props) => props.chart === "area");
    expect(areaProps?.yAxisDomain).toEqual([0, 24]);
    expect(areaProps?.yAxisTicks).toEqual([0, 6, 12, 18, 24]);

    await act(async () => {
      root.unmount();
    });
  });
});
