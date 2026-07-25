// @vitest-environment jsdom
import type { Category } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderDom, unmount } from "../../test/domHarness.js";
import { CategoryPickerSheet } from "./CategoryPickerSheet.js";

function category(id: string, name: string, parentId: string | null): Category {
  return {
    id,
    name,
    parentId,
    color: "#3355aa",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const sleep = category("cat-sleep", "睡眠", null);
const nap = category("cat-sleep-nap", "小睡", "cat-sleep");
const night = category("cat-sleep-night", "夜眠", "cat-sleep");
const misc = category("cat-misc", "杂项", null);

const CHILDREN: Record<string, Category[]> = {
  "cat-sleep": [night, nap],
  "cat-misc": [],
};

function mountSheet(selectedId: string | null, onSelect = vi.fn(), onClose = vi.fn()) {
  return renderDom(
    createElement(CategoryPickerSheet, {
      parentCategories: [sleep, misc],
      getChildren: (parentId: string) => CHILDREN[parentId] ?? [],
      selectedId,
      onSelect,
      onClose,
    }),
  );
}

function rowByLabel(host: HTMLElement, label: string): HTMLElement {
  const row = Array.from(host.querySelectorAll("[data-category-row]")).find(
    (el) => el.getAttribute("data-category-row") === label,
  );
  if (!row) throw new Error(`category row "${label}" not found`);
  return row as HTMLElement;
}

/** 在行内指定横向比例处派发一次真实 click，驱动 rowClickZone 分区判定。 */
async function clickAtRatio(row: HTMLElement, ratio: number): Promise<void> {
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40,
    toJSON: () => ({}),
  } as DOMRect);
  await act(async () => {
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100 * ratio, clientY: 20 }));
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRoots();
});

describe("CategoryPickerSheet", () => {
  it("未选分类时全部折叠，只列全部分类与父分类", async () => {
    const { host, root } = await mountSheet(null);
    expect(host.textContent).toContain("全部分类");
    expect(host.textContent).toContain("睡眠");
    expect(host.textContent).toContain("杂项");
    expect(host.textContent).not.toContain("小睡");
    await unmount(root);
  });

  it("打开时自动展开已选子分类所在的父分类", async () => {
    const { host, root } = await mountSheet("cat-sleep-nap");
    expect(host.textContent).toContain("小睡");
    expect(host.textContent).toContain("夜眠");
    await unmount(root);
  });

  it("父分类行左 2/5 点击只展开、不选中", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { host, root } = await mountSheet(null, onSelect, onClose);
    await clickAtRatio(rowByLabel(host, "睡眠"), 0.1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).toContain("小睡");
    await unmount(root);
  });

  it("父分类行右 3/5 点击选中该父分类并关闭", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { host, root } = await mountSheet(null, onSelect, onClose);
    await clickAtRatio(rowByLabel(host, "睡眠"), 0.8);
    expect(onSelect).toHaveBeenCalledWith("cat-sleep");
    expect(onClose).toHaveBeenCalled();
    await unmount(root);
  });

  it("无子分类的父分类整行点击即选中（左 2/5 也选中）", async () => {
    const onSelect = vi.fn();
    const { host, root } = await mountSheet(null, onSelect);
    await clickAtRatio(rowByLabel(host, "杂项"), 0.1);
    expect(onSelect).toHaveBeenCalledWith("cat-misc");
    await unmount(root);
  });

  it("子分类行点击即选中并关闭", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { host, root } = await mountSheet("cat-sleep-nap", onSelect, onClose);
    await clickAtRatio(rowByLabel(host, "夜眠"), 0.5);
    expect(onSelect).toHaveBeenCalledWith("cat-sleep-night");
    expect(onClose).toHaveBeenCalled();
    await unmount(root);
  });

  it("全部分类行选中 null", async () => {
    const onSelect = vi.fn();
    const { host, root } = await mountSheet("cat-sleep-nap", onSelect);
    await clickAtRatio(rowByLabel(host, "全部分类"), 0.5);
    expect(onSelect).toHaveBeenCalledWith(null);
    await unmount(root);
  });
});
