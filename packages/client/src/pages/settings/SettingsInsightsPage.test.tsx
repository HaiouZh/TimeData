// @vitest-environment jsdom
import type { Category } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsInsightsPage from "./SettingsInsightsPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const categoriesState = vi.hoisted(() => ({
  categories: [] as Category[],
}));
const sleepSettingState = vi.hoisted(() => ({
  sleepCategoryId: null as string | null,
  setSleepCategoryId: vi.fn(),
}));
const todoDestState = vi.hoisted(() => ({
  destination: "today" as "today" | "inbox",
  setTodoDefaultDestination: vi.fn(),
}));
const punchCategoryState = vi.hoisted(() => ({
  punchCategoryId: null as string | null,
  setPunchCategoryId: vi.fn(),
}));

vi.mock("../../lib/settings/todoDefaultDestinationSetting.ts", () => ({
  setTodoDefaultDestination: (value: "today" | "inbox") => todoDestState.setTodoDefaultDestination(value),
  useTodoDefaultDestination: () => todoDestState.destination,
}));

vi.mock("../../hooks/useCategories.ts", () => ({
  useCategories: () => ({
    categories: categoriesState.categories,
    parentCategories: categoriesState.categories.filter((category) => category.parentId === null),
    getChildren: (parentId: string) => categoriesState.categories.filter((category) => category.parentId === parentId),
    getCategoryPath: (categoryId: string) => {
      const category = categoriesState.categories.find((item) => item.id === categoryId);
      if (!category) return "未知";
      if (!category.parentId) return category.name;
      const parent = categoriesState.categories.find((item) => item.id === category.parentId);
      return parent ? `${parent.name} · ${category.name}` : category.name;
    },
  }),
}));

vi.mock("../../lib/sleepCategorySetting.ts", () => ({
  setSleepCategoryId: (value: string | null) => sleepSettingState.setSleepCategoryId(value),
  useSleepCategoryId: () => sleepSettingState.sleepCategoryId,
}));

vi.mock("../../lib/settings/punchCategorySetting.ts", () => ({
  setPunchCategoryId: (value: string | null) => punchCategoryState.setPunchCategoryId(value),
  usePunchCategoryId: () => punchCategoryState.punchCategoryId,
}));

function cat(id: string, name: string, parentId: string | null = null): Category {
  return {
    id,
    name,
    parentId,
    color: "#808080",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

describe("SettingsInsightsPage", () => {
  beforeEach(() => {
    categoriesState.categories = [
      cat("work", "工作"),
      cat("cat-work-deep", "深度", "work"),
      cat("sleep", "睡眠"),
      cat("cat-sleep-night", "夜间睡眠", "sleep"),
    ];
    sleepSettingState.sleepCategoryId = null;
    sleepSettingState.setSleepCategoryId.mockReset();
    todoDestState.destination = "today";
    todoDestState.setTodoDefaultDestination.mockReset();
    punchCategoryState.punchCategoryId = null;
    punchCategoryState.setPunchCategoryId.mockReset();
  });

  it("renders the sleep category selector", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsInsightsPage)));

    expect(html).toContain("杂项");
    expect(html).toContain("睡眠分类");
    expect(html).toContain("睡眠");
  });

  it("persists sleep category selection through synced setting", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsInsightsPage)));
    });

    const select = host.querySelector('[aria-label="睡眠分类"]') as HTMLSelectElement | null;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      if (select && nativeValueSetter) {
        nativeValueSetter.call(select, "sleep");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(sleepSettingState.setSleepCategoryId).toHaveBeenCalledWith("sleep");

    sleepSettingState.sleepCategoryId = "sleep";
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsInsightsPage)));
    });

    expect(host.textContent).toContain("当前使用");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders todo default destination control", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsInsightsPage)));

    expect(html).toContain("新建待办默认落点");
    expect(html).toContain("收件箱");
  });

  it("persists todo default destination selection", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsInsightsPage)));
    });

    const select = host.querySelector('[aria-label="新建待办默认落点"]') as HTMLSelectElement | null;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      if (select && nativeValueSetter) {
        nativeValueSetter.call(select, "inbox");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(todoDestState.setTodoDefaultDestination).toHaveBeenCalledWith("inbox");
    await act(async () => root.unmount());
  });

  it("renders and persists punch category selection from child categories", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsInsightsPage)));
    });

    expect(host.textContent).toContain("打点分类");
    expect(host.textContent).toContain("工作 · 深度");
    const select = host.querySelector('[aria-label="打点分类"]') as HTMLSelectElement | null;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      if (select && nativeValueSetter) {
        nativeValueSetter.call(select, "cat-work-deep");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(punchCategoryState.setPunchCategoryId).toHaveBeenCalledWith("cat-work-deep");
    await act(async () => root.unmount());
  });
});
