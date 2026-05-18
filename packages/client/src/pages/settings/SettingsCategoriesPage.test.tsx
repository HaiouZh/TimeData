import type { Category } from "@timedata/shared";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsCategoriesPage from "./SettingsCategoriesPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const categoriesState = vi.hoisted(() => ({
  categories: [] as Category[],
}));

const addCategoryMock = vi.hoisted(() =>
  vi.fn(async (name: string, parentId: string | null, color: string) => {
    categoriesState.categories.push({
      id: `cat-${name}`,
      name,
      parentId,
      color,
      icon: null,
      sortOrder: categoriesState.categories.filter((category) => category.parentId === parentId).length,
      isArchived: false,
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });
  }),
);

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../hooks/useCategories.ts", () => ({
  useCategories: () => ({
    parentCategories: categoriesState.categories.filter((category) => category.parentId === null),
    getChildren: (parentId: string) => categoriesState.categories.filter((category) => category.parentId === parentId),
    addCategory: addCategoryMock,
    applyCategoryPalette: vi.fn(),
    reorderCategories: vi.fn(),
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  KeyboardSensor: function KeyboardSensor() {},
  MouseSensor: function MouseSensor() {},
  TouchSensor: function TouchSensor() {},
  closestCenter: () => [],
  useSensor: () => null,
  useSensors: () => [],
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
  arrayMove: <T,>(items: T[]) => items,
  sortableKeyboardCoordinates: () => null,
  verticalListSortingStrategy: () => null,
}));

vi.mock("../../components/SortableCategoryItem.tsx", () => ({
  default: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    createElement("div", { className }, children),
}));

vi.mock("./SettingsDetailPage.tsx", () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    createElement("section", { "data-title": title }, children),
}));

describe("SettingsCategoriesPage", () => {
  beforeEach(() => {
    categoriesState.categories = [];
    addCategoryMock.mockClear();
  });

  it("renders empty state when no parent categories exist", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SettingsCategoriesPage));
    });

    expect(host.textContent).toContain("暂无分类");

    await act(async () => {
      root.unmount();
    });
  });

  it("adds a new top-level category through the add dialog", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SettingsCategoriesPage));
    });

    const openButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "+ 新增分类",
    );
    expect(openButton).toBeDefined();

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const nameInput = document.body.querySelector<HTMLInputElement>('input[placeholder="分类名称"]');
    expect(nameInput).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(nameInput, "健康");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "添加",
    );
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(addCategoryMock).toHaveBeenCalledWith("健康", null, "#4A90D9");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
