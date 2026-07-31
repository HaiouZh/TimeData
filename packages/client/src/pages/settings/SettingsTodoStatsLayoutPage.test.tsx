// @vitest-environment jsdom
// biome-ignore-all assist/source/organizeImports: dbReset 必须最先求值（先注册 fake-indexeddb 再 import db 单例）；
// 若被 import 排序挪到 lib/settings（其 import db/index）之后，db/index 会在 fake-idb 注册前捕获到 undefined → MissingAPIError。
import { resetDb } from "../../test/dbReset.ts";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting } from "../../lib/settings/index.ts";
import { click, renderDom, unmount } from "../../test/domHarness.tsx";
import SettingsTodoStatsLayoutPage from "./SettingsTodoStatsLayoutPage.tsx";

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
  default: ({ children, dragLabel }: { children?: React.ReactNode; dragLabel?: string }) =>
    createElement("div", { "aria-label": dragLabel }, children),
}));

beforeEach(resetDb);

const MAX_FLUSHES = 200;

async function waitForLayout(expected: (layout: { order?: string[]; hidden?: string[] }) => boolean): Promise<void> {
  for (let i = 0; i < MAX_FLUSHES; i += 1) {
    const raw = await getSetting("stats.todo.layout.v1");
    const layout = raw ? (JSON.parse(raw) as { order?: string[]; hidden?: string[] }) : {};
    if (expected(layout)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for stats.todo.layout.v1");
}

async function renderPage() {
  dndState.onDragEnds = [];
  return await renderDom(createElement(MemoryRouter, null, createElement(SettingsTodoStatsLayoutPage)));
}

describe("SettingsTodoStatsLayoutPage", () => {
  it("列出全部模块标题", async () => {
    const { host, root } = await renderPage();
    for (const title of ["总览", "创建分布", "完成分布", "存活时长分布", "完成热力图", "周期指标", "节奏", "维度拆解", "删除洞察"]) {
      expect(host.textContent).toContain(title);
    }
    await unmount(root);
  });

  it("隐藏某模块写入 layout，hidden 含该 id", async () => {
    const { host, root } = await renderPage();
    const toggle = host.querySelector('[role="switch"][aria-label="显示 创建分布"]');
    await click(toggle);

    await waitForLayout((layout) => layout.hidden?.includes("created") ?? false);

    await unmount(root);
  });

  it("拖动改变 order 并落库", async () => {
    const { root } = await renderPage();
    const [dragEnd] = dndState.onDragEnds;
    await act(async () => {
      dragEnd?.({ active: { id: "created" }, over: { id: "overview" } });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await waitForLayout((layout) => layout.order?.[0] === "created");

    await unmount(root);
  });

  it("先隐藏一个模块，再拖拽另一个模块，hidden 保持且顺序更新", async () => {
    const { host, root } = await renderPage();
    await click(host.querySelector('[role="switch"][aria-label="显示 创建分布"]'));
    await waitForLayout((layout) => layout.hidden?.includes("created") ?? false);

    // 等组件带新 hidden 重渲染（liveQuery 异步）再取最新 onDragEnd，避免旧闭包把 hidden 冲回空集
    const handlersAfterToggle = dndState.onDragEnds.length;
    for (let i = 0; i < MAX_FLUSHES && dndState.onDragEnds.length <= handlersAfterToggle; i += 1) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }
    const dragEnd = dndState.onDragEnds.at(-1);
    await act(async () => {
      dragEnd?.({ active: { id: "created" }, over: { id: "overview" } });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await waitForLayout(
      (layout) => layout.order?.[0] === "created" && (layout.hidden?.includes("created") ?? false),
    );

    await unmount(root);
  });

  it("全部行渲染拖拽手柄且无上移/下移按钮", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[aria-label="拖动 创建分布"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="上移 创建分布"]')).toBeNull();
    expect(host.querySelector('[aria-label="下移 创建分布"]')).toBeNull();
    await unmount(root);
  });

  it("重置恢复默认顺序", async () => {
    const { host, root } = await renderPage();
    const [dragEnd] = dndState.onDragEnds;
    await act(async () => {
      dragEnd?.({ active: { id: "created" }, over: { id: "overview" } });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitForLayout((layout) => layout.order?.[0] === "created");

    const reset = host.querySelector('button[aria-label="重置默认布局"]');
    await click(reset);
    await waitForLayout((layout) => layout.order?.[0] === "overview");

    await unmount(root);
  });
});