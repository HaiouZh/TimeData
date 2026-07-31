// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { readDesktopSidebarConfig } from "../../lib/settings/desktopSidebarSetting.js";
import { readVisibleTabs } from "../../lib/settings/navVisibleTabsSetting.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { SettingsNavPage } from "./SettingsNavPage.js";

vi.mock("../../lib/settings/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/index.ts")>();
  return { ...actual, useSetting: () => null };
});

const dndState = vi.hoisted(() => ({ onDragEnds: [] as Array<(event: unknown) => void> }));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children?: React.ReactNode; onDragEnd?: (event: unknown) => void }) => {
    if (onDragEnd) dndState.onDragEnds.push(onDragEnd);
    return createElement("div", null, children);
  },
  KeyboardSensor: function KeyboardSensor() {},
  MouseSensor: function MouseSensor() {},
  TouchSensor: function TouchSensor() {},
  closestCenter: () => [],
  useSensor: () => null,
  useSensors: () => [],
}));

vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    SortableContext: ({ children }: { children?: React.ReactNode }) => createElement("div", null, children),
    verticalListSortingStrategy: () => null,
  };
});

vi.mock("../../components/SortableCategoryItem.tsx", () => ({
  default: ({
    children,
    dragLabel,
    className,
  }: {
    children?: React.ReactNode;
    dragLabel?: string;
    className?: string;
  }) => createElement("div", { className, "data-drag-handle": dragLabel }, children),
}));

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  dndState.onDragEnds = [];
  return renderDom(createElement(MemoryRouter, null, createElement(SettingsNavPage)));
}

async function clickAndFlushSettings(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForTabs(predicate: (tabs: string[]) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    if (predicate(await readVisibleTabs())) return;
  }
  throw new Error("Timed out waiting for nav.visibleTabs.v1");
}

async function waitForDesktopConfig(predicate: (items: { to: string; placement: string }[]) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    if (predicate(await readDesktopSidebarConfig())) return;
  }
  throw new Error("Timed out waiting for nav.desktopSidebar.v1");
}

describe("SettingsNavPage", () => {
  it("toggles a tab off and persists", async () => {
    const { host, root } = await renderPage();
    await clickAndFlushSettings(host.querySelector('[role="switch"][aria-label="轨道"]'));
    await waitForTabs((tabs) => tabs.includes("/stats/time") && !tabs.includes("/tracks"));
    await unmount(root);
  });

  it("offers 轨道, 目标 and 时间 as separate toggles, not 统计", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[role="switch"][aria-label="轨道"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="目标"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="时间"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="统计"]')).toBeNull();
    await unmount(root);
  });

  it("does not offer 设置 as toggleable", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[role="switch"][aria-label="设置"]')).toBeNull();
    await unmount(root);
  });

  it("renders separate mobile and desktop navigation sections with the new mobile placement semantics", async () => {
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("手机底栏");
    expect(host.textContent).toContain("关闭后显示在“设置 > 更多功能”");
    expect(host.textContent).toContain("桌面侧栏");
    expect(host.textContent).toContain("记录");
    expect(host.textContent).toContain("更多");

    await unmount(root);
  });

  it("shows route labels for configuration without module-color identity language", async () => {
    const retiredTextModuleClass = "text-" + "mo" + "d-";
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("记录");
    expect(host.textContent).toContain("时间轴");
    expect(host.textContent).toContain("侧栏");
    expect(host.innerHTML).not.toContain(retiredTextModuleClass);
    expect(host.textContent).not.toContain("模块色");
    expect(host.textContent).not.toContain("彩色模块");

    await unmount(root);
  });

  it("renders drag handles for both lists and no arrow buttons", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[data-drag-handle="拖动 记录"]')).not.toBeNull();
    expect(host.querySelector('[data-drag-handle="拖动 待办"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="上移 记录"]')).toBeNull();
    expect(host.querySelector('button[aria-label="下移 记录"]')).toBeNull();
    await unmount(root);
  });

  it("drags a mobile tab and persists the new order", async () => {
    const { host, root } = await renderPage();
    const [mobileDragEnd] = dndState.onDragEnds;
    await act(async () => {
      mobileDragEnd?.({ active: { id: "/diary" }, over: { id: "/todo" } });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitForTabs((tabs) => {
      const diary = tabs.indexOf("/diary");
      const todo = tabs.indexOf("/todo");
      return diary !== -1 && todo !== -1 && diary > todo;
    });
    await unmount(root);
  });

  it("drags a desktop item and persists the new order", async () => {
    const { host, root } = await renderPage();
    const [, desktopDragEnd] = dndState.onDragEnds;
    await act(async () => {
      desktopDragEnd?.({ active: { id: "/diary" }, over: { id: "/quick-notes" } });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitForDesktopConfig((items) => items[0]?.to === "/diary" && items[1]?.to === "/quick-notes");
    await unmount(root);
  });

  it("moves a desktop sidebar item into more and persists placement", async () => {
    const { host, root } = await renderPage();

    await clickAndFlushSettings(host.querySelector('button[aria-label="收进更多 轨道"]'));
    await waitForDesktopConfig((items) => items.find((item) => item.to === "/tracks")?.placement === "more");

    await unmount(root);
  });

  it("restores default desktop sidebar config", async () => {
    const { host, root } = await renderPage();

    await clickAndFlushSettings(host.querySelector('button[aria-label="收进更多 轨道"]'));
    await waitForDesktopConfig((items) => items.find((item) => item.to === "/tracks")?.placement === "more");

    await clickAndFlushSettings(host.querySelector('button[aria-label="恢复桌面侧栏默认"]'));
    await waitForDesktopConfig((items) => items.every((item) => item.placement === "primary"));

    await unmount(root);
  });
});
