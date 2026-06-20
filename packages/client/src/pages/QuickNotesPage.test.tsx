// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Category } from "@timedata/shared";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { db } from "../db/index.js";
import { setQuickNotePinned } from "../lib/quickNotes.js";
import { setPunchCategoryId } from "../lib/settings/punchCategorySetting.js";
import { setTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import QuickNotesPage from "./QuickNotesPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const syncAfterWriteMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => ({ syncAfterWrite: syncAfterWriteMock }),
}));

function BottomNavStateProbe() {
  const { hidden } = useBottomNav();
  return createElement("span", { "data-testid": "bottom-nav-hidden" }, String(hidden));
}

async function act(callback: () => Promise<void> | void) {
  let result: Promise<void> | void;
  flushSync(() => {
    result = callback();
  });
  await result;
  flushSync(() => {});
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function renderPage(initialEntry = "/quick-notes"): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        createElement(BottomNavProvider, null, createElement(BottomNavStateProbe), createElement(QuickNotesPage)),
      ),
    );
  });
  await flush();
  return { host, root };
}

function input(host: HTMLElement): HTMLTextAreaElement {
  const element = host.querySelector('textarea[aria-label="速记输入"]');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("missing input");
  return element;
}

function searchInput(host: HTMLElement): HTMLInputElement {
  const element = host.querySelector('input[aria-label="搜索速记"]');
  if (!(element instanceof HTMLInputElement)) throw new Error("missing search input");
  return element;
}

function bottomNavHidden(host: HTMLElement): string | null {
  return host.querySelector('[data-testid="bottom-nav-hidden"]')?.textContent ?? null;
}

async function typeInto(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function typeIntoSearch(element: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

// 控制 useIsWideScreen 的判定：宽屏回车发送，窄屏回车换行。afterEach 的 unstubAllGlobals 自动清理。
function stubScreenWidth(wide: boolean) {
  const mql = {
    matches: wide,
    media: "(min-width: 1024px)",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("missing clickable element");
  await act(async () => {
    element.click();
  });
  await flush();
}

async function openMenu(host: HTMLElement, label: string) {
  const bubble = Array.from(host.querySelectorAll('[role="button"]')).find(
    (element) => element.getAttribute("aria-label") === `速记：${label}`,
  );
  if (!(bubble instanceof HTMLElement)) throw new Error(`missing bubble ${label}`);
  await act(async () => {
    bubble.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  await flush();
}

function menuItem(host: HTMLElement, text: string): HTMLButtonElement | null {
  const match = Array.from(host.querySelectorAll('button[role="menuitem"]')).find(
    (button) => button.textContent === text,
  );
  return (match as HTMLButtonElement) ?? null;
}

function lastButtonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  const matches = Array.from(host.querySelectorAll("button")).filter((button) => button.textContent === text);
  return matches.at(-1) ?? null;
}

function markByText(host: HTMLElement, text: string): HTMLElement | null {
  return (
    Array.from(host.querySelectorAll("mark")).find((element) => element.textContent === text) as HTMLElement | undefined
  ) ?? null;
}

function category(id: string, name: string, parentId: string | null): Category {
  return {
    id,
    name,
    parentId,
    color: "#94A3B8",
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
  };
}

async function configurePunchCategory() {
  await db.categories.bulkAdd([
    category("cat-work", "工作", null),
    category("cat-work-deep", "深度", "cat-work"),
  ]);
  await setPunchCategoryId("cat-work-deep");
  await db.syncLog.clear();
}

// 搜索去抖是组件内真实计时器；调用方需先 vi.useFakeTimers，这里确定性推进，避免真实 240ms 等待。
async function waitForSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(240);
  });
  await flush();
}

beforeEach(async () => {
  syncAfterWriteMock.mockClear();
  await db.quickNotes.clear();
  await db.timeEntries.clear();
  await db.categories.clear();
  await db.settings.clear();
  await db.syncLog.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("QuickNotesPage", () => {
  it("sends a quick note and clears the input", async () => {
    const { host, root } = await renderPage();

    await typeInto(input(host), "  一个想法  ");
    await click(host.querySelector('button[type="submit"]'));

    expect(host.textContent).toContain("一个想法");
    expect(input(host).value).toBe("");
    await expect(db.quickNotes.count()).resolves.toBe(1);
    await expect(db.timeEntries.count()).resolves.toBe(0);
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("does not send empty text", async () => {
    const { host, root } = await renderPage();

    await typeInto(input(host), "   ");
    await click(host.querySelector('button[type="submit"]'));

    await expect(db.quickNotes.count()).resolves.toBe(0);

    await act(async () => root.unmount());
  });

  it("does not enter edit mode on a single click of a bubble", async () => {
    await db.quickNotes.add({
      id: "note-1",
      text: "只读单击",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await click(host.querySelector('[role="button"][aria-label="速记：只读单击"]'));

    expect(input(host).value).toBe("");
    expect(host.textContent).not.toContain("正在编辑");

    await act(async () => root.unmount());
  });

  it("exposes a native date input on the floating scroll date chip", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "first-day",
        text: "第一天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "second-day",
        text: "第二天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();
    const list = host.querySelector('[aria-label="速记列表"]');
    if (!(list instanceof HTMLElement)) throw new Error("missing quick notes list");
    const dividers = Array.from(host.querySelectorAll<HTMLElement>("[data-date-label]"));
    const firstDivider = dividers[0];
    const secondDivider = dividers[1];
    if (!firstDivider || !secondDivider) throw new Error("missing date dividers");
    Object.defineProperty(firstDivider, "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(secondDivider, "offsetTop", { value: 120, configurable: true });

    // 日期气泡扫描经 rAF 节流；用例内把 rAF 同步化，保证断言可确定地观察到结果。
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    await act(async () => {
      Object.defineProperty(list, "scrollTop", { value: 130, configurable: true });
      Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await flush();

    const floatingDateInput = host.querySelector('input[aria-label="选择当前浮层日期"]');
    expect(floatingDateInput).toBeInstanceOf(HTMLInputElement);
    expect((floatingDateInput as HTMLInputElement).type).toBe("date");
    expect((floatingDateInput as HTMLInputElement).value).toBe("2026-06-02");

    vi.unstubAllGlobals();
    await act(async () => root.unmount());
  });

  it("近底部的滚动驱动重渲染不把滚动位置弹回底部（安卓抖动回归）", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "n1",
        text: "第一条",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "n2",
        text: "第二条",
        occurredAt: "2026-06-01T04:01:00.000Z",
        createdAt: "2026-06-01T04:01:00.000Z",
        updatedAt: "2026-06-01T04:01:00.000Z",
      },
      {
        id: "n3",
        text: "第三条",
        occurredAt: "2026-06-01T04:02:00.000Z",
        createdAt: "2026-06-01T04:02:00.000Z",
        updatedAt: "2026-06-01T04:02:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();
    const list = host.querySelector('[aria-label="速记列表"]');
    if (!(list instanceof HTMLElement)) throw new Error("missing quick notes list");

    // 用可跟踪的 scrollTop 模拟布局：底部位于 scrollHeight - clientHeight = 600。
    let scrollTopValue = 580; // 距底 20px，仍在吸底阈值（48px）内
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 400 });

    // 用户在底部附近缓慢上滑，触发一次滚动驱动的重渲染（更新日期气泡等 UI 状态）。
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await flush();

    // 修复前：无依赖的吸底 layout effect 会把 scrollTop 弹回 scrollHeight(1000) → 抖动。
    // 修复后：内容未变 → 不触发吸底 → 停在用户停留的位置 580。
    expect(scrollTopValue).toBe(580);

    await act(async () => root.unmount());
  });

  it("passes per-note upload state into bubbles", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "pending-note",
        text: "待上传",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "uploaded-note",
        text: "已上传",
        occurredAt: "2026-06-01T04:01:00.000Z",
        createdAt: "2026-06-01T04:01:00.000Z",
        updatedAt: "2026-06-01T04:01:00.000Z",
      },
    ]);
    await db.syncLog.add({
      id: "pending-log",
      tableName: "quick_notes",
      recordId: "pending-note",
      action: "create",
      timestamp: "2026-06-01T04:00:00.000Z",
      synced: 0,
    });

    const { host, root } = await renderPage();
    const pendingBubble = host.querySelector('[role="button"][aria-label="速记：待上传"]');
    const uploadedBubble = host.querySelector('[role="button"][aria-label="速记：已上传"]');

    expect(pendingBubble?.querySelector('[aria-label="待上传"]')).not.toBeNull();
    expect(uploadedBubble?.querySelector('[aria-label="已上传"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("opens pinned quick notes from the header without repeating them in the timeline", async () => {
    await db.quickNotes.add({
      id: "note-pin",
      text: "钉住我",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    await setQuickNotePinned("note-pin", true, { now: new Date("2026-06-01T05:00:00.000Z") });
    await db.syncLog.clear();

    const { host, root } = await renderPage();

    expect(host.querySelector('[aria-label="速记：钉住我"]')).toBeNull();

    await click(host.querySelector('button[aria-label="查看置顶速记，1 条"]'));

    const pinnedRegion = host.querySelector('[aria-label="置顶速记"]');
    expect(pinnedRegion).toBeInstanceOf(HTMLElement);
    expect(pinnedRegion?.textContent).toContain("钉住我");
    expect(pinnedRegion?.closest('[aria-label="速记列表"]')).toBeNull();
    expect(host.querySelector('button[aria-label="关闭置顶速记"]')).toBeNull();

    await click(host.querySelector('button[aria-label="收起置顶速记，1 条"]'));

    expect(host.querySelector('[aria-label="置顶速记"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("expands the bottom input when editing a long note", async () => {
    const longText = Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 行`).join("\n");
    await db.quickNotes.add({
      id: "note-1",
      text: longText,
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    Object.defineProperty(input(host), "scrollHeight", { value: 180, configurable: true });

    await openMenu(host, longText);
    await click(menuItem(host, "编辑"));

    expect(input(host).value).toBe(longText);
    expect(input(host).style.height).toBe("160px");
    expect(input(host).style.overflowY).toBe("auto");

    await act(async () => root.unmount());
  });

  it("reserves bottom space from the measured composer height", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLFormElement) {
        return {
          x: 0,
          y: 0,
          width: 390,
          height: 148,
          top: 0,
          right: 390,
          bottom: 148,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    const { host, root } = await renderPage();
    const list = host.querySelector('[aria-label="速记列表"]');

    expect(list).toBeInstanceOf(HTMLElement);
    expect((list as HTMLElement).style.paddingBottom).toBe("164px");

    await act(async () => root.unmount());
  });

  it("hides the bottom nav while the composer input is focused", async () => {
    const { host, root } = await renderPage();
    const composerInput = input(host);

    expect(bottomNavHidden(host)).toBe("false");

    await act(async () => {
      composerInput.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await flush();

    expect(bottomNavHidden(host)).toBe("true");

    await act(async () => {
      composerInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await flush();

    expect(bottomNavHidden(host)).toBe("false");

    await act(async () => root.unmount());
  });

  it("edits a note through the popover menu into the bottom input", async () => {
    await db.quickNotes.add({
      id: "note-1",
      text: "旧文本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await openMenu(host, "旧文本");
    await click(menuItem(host, "编辑"));

    expect(input(host).value).toBe("旧文本");
    expect(host.textContent).toContain("正在编辑");

    await typeInto(input(host), "新文本");
    await click(host.querySelector('button[type="submit"]'));

    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({
      text: "新文本",
      occurredAt: "2026-06-01T04:00:00.000Z",
    });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("copies a note through the popover menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await db.quickNotes.add({
      id: "note-1",
      text: "复制我",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await openMenu(host, "复制我");
    await click(menuItem(host, "复制"));

    expect(writeText).toHaveBeenCalledWith("复制我");

    await act(async () => root.unmount());
  });

  it("auto-dismisses the copied status after a delay", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await db.quickNotes.add({
      id: "note-1",
      text: "复制我",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    vi.useFakeTimers({ shouldAdvanceTime: true });

    await openMenu(host, "复制我");
    await click(menuItem(host, "复制"));
    expect(host.textContent).toContain("已复制");

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    await flush();
    expect(host.textContent).not.toContain("已复制");

    vi.useRealTimers();
    await act(async () => root.unmount());
  });

  it("deletes a note through the popover menu and confirm dialog", async () => {
    await db.quickNotes.add({
      id: "note-1",
      text: "待删除",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await openMenu(host, "待删除");
    await click(menuItem(host, "删除"));

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除这条速记");
    await click(lastButtonByText(host, "删除"));

    await expect(db.quickNotes.count()).resolves.toBe(0);
    expect(host.textContent).not.toContain("待删除");
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("宽屏：回车发送，Shift+回车不发送", async () => {
    stubScreenWidth(true);
    const { host, root } = await renderPage();

    await typeInto(input(host), "回车发送");
    await act(async () => {
      input(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    await expect(db.quickNotes.count()).resolves.toBe(1);

    await typeInto(input(host), "不发送");
    await act(async () => {
      input(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });
    await flush();
    await expect(db.quickNotes.count()).resolves.toBe(1);

    await act(async () => root.unmount());
  });

  it("窄屏：回车换行不发送（移动端交给 textarea 默认换行）", async () => {
    stubScreenWidth(false);
    const { host, root } = await renderPage();

    await typeInto(input(host), "手机端回车");
    await act(async () => {
      input(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    // 窄屏回车不提交，草稿保留，由用户点「记录」按钮发送
    await expect(db.quickNotes.count()).resolves.toBe(0);
    expect(input(host).value).toBe("手机端回车");

    await act(async () => root.unmount());
  });

  it("clears a selected date through the cleanup action", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "today",
        text: "当天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "other",
        text: "别天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    await click(host.querySelector('button[aria-label="更多操作"]'));
    await click(menuItem(host, "清理当天"));

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除当天速记");
    await click(lastButtonByText(host, "删除"));

    await expect(db.quickNotes.get("today")).resolves.toBeUndefined();
    await expect(db.quickNotes.get("other")).resolves.toMatchObject({ text: "别天" });

    await act(async () => root.unmount());
  });

  it("opens search mode with an empty-query hint and hides the bottom composer", async () => {
    const { host, root } = await renderPage();

    await click(host.querySelector('button[aria-label="搜索速记"]'));

    expect(host.querySelector('input[placeholder="搜索速记…"]')).toBeInstanceOf(HTMLInputElement);
    expect(host.textContent).toContain("空格分隔多个词");
    expect(host.querySelector('textarea[aria-label="速记输入"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("shows matching search results with highlights and an empty state for misses", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "meeting",
        text: "和张三开会议",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "milk",
        text: "买牛奶",
        occurredAt: "2026-06-01T05:00:00.000Z",
        createdAt: "2026-06-01T05:00:00.000Z",
        updatedAt: "2026-06-01T05:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();

    // 搜索去抖用 fake timers 确定性推进；shouldAdvanceTime 让 flush 的 setTimeout(0) 仍能结算。
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await click(host.querySelector('button[aria-label="搜索速记"]'));
    await typeIntoSearch(searchInput(host), "会议");
    await waitForSearchDebounce();

    expect(markByText(host, "会议")).toBeInstanceOf(HTMLElement);
    expect(host.textContent).not.toContain("买牛奶");

    await typeIntoSearch(searchInput(host), "不存在的词");
    await waitForSearchDebounce();

    expect(host.textContent).toContain("没有匹配的速记");

    vi.useRealTimers();
    await act(async () => root.unmount());
  });

  it("closes search mode and restores the bottom composer", async () => {
    const { host, root } = await renderPage();

    await click(host.querySelector('button[aria-label="搜索速记"]'));
    await click(host.querySelector('button[aria-label="退出搜索"]'));

    expect(input(host)).toBeInstanceOf(HTMLTextAreaElement);
    expect(host.querySelector('input[placeholder="搜索速记…"]')).toBeNull();

    await act(async () => root.unmount());
  });
});

describe("捕捉中心", () => {
  beforeEach(async () => {
    await db.tasks.clear();
    await db.quickNotes.clear();
    await db.timeEntries.clear();
    await db.categories.clear();
    await db.syncLog.clear();
  });

  it("头部只有一个打点钮，且不再显示窗口计数标题", async () => {
    const { host, root } = await renderPage();

    const punchButtons = host.querySelectorAll('button[aria-label="打点（记录到现在）"]');
    expect(punchButtons).toHaveLength(1);
    expect(host.textContent).not.toContain("当前窗口");

    await act(async () => root.unmount());
  });

  it("点「待办」把输入文本存成池任务并清空输入", async () => {
    const { host, root } = await renderPage();
    await typeInto(input(host), "买牛奶");

    const todoButton = host.querySelector('button[aria-label="存为待办"]');
    await click(todoButton);

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "买牛奶", done: false });
    expect(input(host).value).toBe("");

    await act(async () => root.unmount());
  });

  it("存为待办成功反馈内嵌在 composer 内", async () => {
    const { host, root } = await renderPage();
    await typeInto(input(host), "买牛奶");
    await click(host.querySelector('button[aria-label="存为待办"]'));

    const feedback = host.querySelector('[aria-label="捕捉操作反馈"]');
    const composer = host.querySelector('form[aria-label="速记输入区"]');

    expect(composer?.contains(feedback)).toBe(true);
    expect(host.querySelector('[data-action-toast-overlay="true"]')).toBeNull();
    expect(feedback?.textContent).toContain("已加入今天");
    expect(feedback?.textContent).toContain("去待办");

    await act(async () => root.unmount());
  });

  it("点「打点」建一条已配置分类的时间记录", async () => {
    await configurePunchCategory();
    const { host, root } = await renderPage();

    const punchButton = host.querySelector('button[aria-label="打点（记录到现在）"]');
    await click(punchButton);

    const entries = await db.timeEntries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].categoryId).toBe("cat-work-deep");

    await act(async () => root.unmount());
  });

  it("打点成功反馈内嵌在 composer 内，不再底部浮层覆盖列表", async () => {
    await configurePunchCategory();
    const { host, root } = await renderPage();
    await click(host.querySelector('button[aria-label="打点（记录到现在）"]'));

    const feedback = host.querySelector('[aria-label="捕捉操作反馈"]');
    const composer = host.querySelector('form[aria-label="速记输入区"]');

    expect(composer?.contains(feedback)).toBe(true);
    expect(host.querySelector('[data-action-toast-overlay="true"]')).toBeNull();
    expect(feedback?.textContent).toContain("已打点");
    expect(feedback?.textContent).toContain("撤销");

    await act(async () => root.unmount());
  });

  it("速记「待办」按钮按默认落点：inbox 时新任务无排期", async () => {
    await db.settings.clear();
    await setTodoDefaultDestination("inbox");

    const { host, root } = await renderPage();
    await typeInto(input(host), "丢进收件箱");

    const todoBtn = host.querySelector('button[aria-label="存为待办"]');
    await click(todoBtn);

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].scheduledAt).toBeNull();

    await act(async () => root.unmount());
  });
});
