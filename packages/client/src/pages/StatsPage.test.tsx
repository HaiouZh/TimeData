import type { Category } from "@timedata/shared";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StatsPage from "./StatsPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const categoriesState = vi.hoisted(() => ({
  categories: [] as Category[],
}));

const entriesState = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => entriesState.entries,
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
    entriesState.entries = [];
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
      monthButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(monthButton?.getAttribute("aria-pressed")).toBe("true");
    expect(weekButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      root.unmount();
    });
  });

  it("初始停在最新周期，下一周期按钮禁用；上一周期后启用", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(StatsPage));
    });

    const prevButton = host.querySelector('[aria-label="上一周"]') as HTMLButtonElement | null;
    const nextButton = host.querySelector('[aria-label="下一周"]') as HTMLButtonElement | null;
    expect(prevButton).not.toBeNull();
    expect(nextButton).not.toBeNull();
    // 锚点初始化为今天，最新周期不允许再往后
    expect(nextButton?.disabled).toBe(true);

    await act(async () => {
      prevButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 翻到上一周期后，可以再往后翻
    expect(nextButton?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("回到今天：翻到上一周后出现，点击后回到最新", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(StatsPage));
    });

    const prevButton = host.querySelector('[aria-label="上一周"]') as HTMLButtonElement | null;
    // 初始最新周期，无"回到今天"
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "回到今天")).toBe(false);

    await act(async () => {
      prevButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const backButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "回到今天",
    ) as HTMLButtonElement | undefined;
    expect(backButton).toBeTruthy();

    await act(async () => {
      backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const nextButton = host.querySelector('[aria-label="下一周"]') as HTMLButtonElement | null;
    expect(nextButton?.disabled).toBe(true);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "回到今天")).toBe(false);
  });

  it("日模式可翻页，按钮标签随模式变化", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(StatsPage));
    });

    const dayButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "日");
    await act(async () => {
      dayButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const prevDay = host.querySelector('[aria-label="上一天"]') as HTMLButtonElement | null;
    const nextDay = host.querySelector('[aria-label="下一天"]') as HTMLButtonElement | null;
    expect(prevDay).not.toBeNull();
    expect(nextDay?.disabled).toBe(true); // 今天是最新

    await act(async () => {
      prevDay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(nextDay?.disabled).toBe(false);
  });

  it("指定睡眠分类后，工作类超长记录出现在异常区", async () => {
    categoriesState.categories = [
      { id: "work", name: "工作", parentId: null, color: "#3b82f6", icon: null, sortOrder: 0, isArchived: false, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" },
      { id: "sleep", name: "睡眠", parentId: null, color: "#64748b", icon: null, sortOrder: 1, isArchived: false, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" },
    ];
    // 一条 10h 工作（超过 floor 180min）
    entriesState.entries = [
      { id: "long", categoryId: "work", startTime: "2026-05-08T01:00:00.000Z", endTime: "2026-05-08T11:00:00.000Z", note: null, createdAt: "2026-05-08T01:00:00.000Z", updatedAt: "2026-05-08T01:00:00.000Z" },
    ];

    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(StatsPage));
    });

    // 默认未指定睡眠 -> 选择器存在
    const select = host.querySelector('[aria-label="睡眠分类"]') as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    // 切到日模式并跳到 2026-05-08，使该条落入范围
    const dayButton = [...host.querySelectorAll("button")].find((b) => b.textContent === "日");
    await act(async () => {
      dayButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dateInput = host.querySelector('input[type="date"]') as HTMLInputElement | null;
    // React 受控 input：直接设 .value 不会被 React 的 onChange 识别，需用原型 setter 再派发 change。
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      if (dateInput && nativeValueSetter) {
        nativeValueSetter.call(dateInput, "2026-05-08");
        dateInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // 异常区出现超长记录文案
    expect(host.textContent).toContain("疑似忘停");

    await act(async () => {
      root.unmount();
    });
  });
});
