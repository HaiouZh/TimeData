// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Category } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StatsPage from "./StatsPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const categoriesState = vi.hoisted(() => ({
  categories: [] as Category[],
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => [],
}));

vi.mock("recharts", () => ({
  PieChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  Pie: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  Cell: () => createElement("span"),
  BarChart: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  Bar: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  XAxis: () => createElement("span"),
  YAxis: () => createElement("span"),
  Tooltip: () => createElement("span"),
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
}));

vi.mock("../hooks/useCategories.ts", () => ({
  useCategories: () => ({
    categories: categoriesState.categories,
    parentCategories: categoriesState.categories.filter((category) => category.parentId === null),
  }),
}));

describe("StatsPage", () => {
  beforeEach(() => {
    categoriesState.categories = [];
  });

  it("renders empty state and allows period switching", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(StatsPage));
    });

    expect(host.textContent).toContain("暂无统计数据");

    const weekButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "周");
    const monthButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "月");
    expect(weekButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      monthButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(monthButton?.getAttribute("aria-pressed")).toBe("true");
    expect(weekButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      root.unmount();
    });
  });
});
