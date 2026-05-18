import type { Category } from "@timedata/shared";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsCategoryDetailPage from "./SettingsCategoryDetailPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const categoriesState = vi.hoisted(() => ({
  categories: [] as Category[],
}));

const updateCategoryColorMock = vi.hoisted(() =>
  vi.fn(async (id: string, color: string) => {
    const target = categoriesState.categories.find((category) => category.id === id);
    if (target) target.color = color;
  }),
);

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
  useParams: () => ({ id: "cat-work" }),
}));

vi.mock("../../hooks/useCategories.ts", () => ({
  useCategories: () => ({
    parentCategories: categoriesState.categories.filter((category) => category.parentId === null),
    getChildren: (parentId: string) => categoriesState.categories.filter((category) => category.parentId === parentId),
    addCategory: addCategoryMock,
    renameCategory: vi.fn(),
    updateCategoryColor: updateCategoryColorMock,
    deleteCategory: vi.fn(),
    getCategoryDeleteImpact: vi.fn(async () => ({ categoryIds: [], childCount: 0, entryCount: 0 })),
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

describe("SettingsCategoryDetailPage", () => {
  beforeEach(() => {
    categoriesState.categories = [
      {
        id: "cat-work",
        name: "工作",
        parentId: null,
        color: "#4A90D9",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    ];
    addCategoryMock.mockClear();
    updateCategoryColorMock.mockClear();
  });

  it("renders the category name in the detail header", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SettingsCategoryDetailPage));
    });

    const section = host.querySelector('section[data-title="工作"]');
    expect(section).not.toBeNull();
    expect(host.textContent).toContain("暂无子分类");

    await act(async () => {
      root.unmount();
    });
  });

  it("adds a child category under the current parent", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SettingsCategoryDetailPage));
    });

    const openButton = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "+ 新增");
    expect(openButton).toBeDefined();

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const nameInput = document.body.querySelector<HTMLInputElement>('input[placeholder="子分类名称"]');
    expect(nameInput).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(nameInput, "会议");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "添加",
    );
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(addCategoryMock).toHaveBeenCalledWith("会议", "cat-work", "#4A90D9");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("updates category color through the color editor", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(SettingsCategoryDetailPage));
    });

    const openEditor = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "修改");
    expect(openEditor).toBeDefined();

    await act(async () => {
      openEditor?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const swatch = document.body.querySelector<HTMLButtonElement>('button[aria-label="选择颜色 #D0021B"]');
    expect(swatch).not.toBeNull();

    await act(async () => {
      swatch?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    );
    expect(saveButton).toBeDefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateCategoryColorMock).toHaveBeenCalledWith("cat-work", "#D0021B");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
