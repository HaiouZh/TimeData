// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { db } from "../db/index.js";
import { setQuickNotePinned } from "../lib/quickNotes.js";
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

async function waitForSearchDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 240));
  });
  await flush();
}

beforeEach(async () => {
  syncAfterWriteMock.mockClear();
  await db.quickNotes.clear();
  await db.timeEntries.clear();
  await db.syncLog.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it("uses a blue bubble background for agent notes without adding a second border", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "user-note",
        text: "用户速记",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "agent-note",
        text: "Agent 速记",
        occurredAt: "2026-06-01T04:01:00.000Z",
        createdAt: "2026-06-01T04:01:00.000Z",
        updatedAt: "2026-06-01T04:01:00.000Z",
        source: "agent",
        sourceLabel: "Hermes",
      },
    ]);
    const { host, root } = await renderPage();

    const userBubble = host.querySelector('[role="button"][aria-label="速记：用户速记"]');
    const agentBubble = host.querySelector('[role="button"][aria-label="速记：Agent 速记"]');

    expect(userBubble).toBeInstanceOf(HTMLElement);
    expect(agentBubble).toBeInstanceOf(HTMLElement);
    expect((userBubble as HTMLElement).className).toContain("bg-slate-900/90");
    expect((agentBubble as HTMLElement).className).toContain("bg-sky-500/10");
    expect((agentBubble as HTMLElement).className).toContain("focus:ring-2 focus:ring-emerald-400/40");
    expect(agentBubble?.innerHTML).not.toContain("border-sky");

    await act(async () => root.unmount());
  });

  it("renders a unified bubble layout without legacy time separators", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "first-note",
        text: "第一条",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "second-note",
        text: "第二条",
        occurredAt: "2026-06-01T04:08:00.000Z",
        createdAt: "2026-06-01T04:08:00.000Z",
        updatedAt: "2026-06-01T04:08:00.000Z",
      },
    ]);

    const { host, root } = await renderPage();

    expect(host.innerHTML).not.toContain("grid-cols-[4.25rem_minmax");
    expect(host.innerHTML).not.toContain("float-right");
    expect(host.querySelector('[role="button"][aria-label="速记：第一条"]')).toBeInstanceOf(HTMLElement);
    expect(host.querySelector('[role="button"][aria-label="速记：第二条"]')).toBeInstanceOf(HTMLElement);

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

  it("sends on Enter and keeps Shift+Enter from submitting", async () => {
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

    await click(host.querySelector('button[aria-label="搜索速记"]'));
    await typeIntoSearch(searchInput(host), "会议");
    await waitForSearchDebounce();

    expect(markByText(host, "会议")).toBeInstanceOf(HTMLElement);
    expect(host.textContent).not.toContain("买牛奶");

    await typeIntoSearch(searchInput(host), "不存在的词");
    await waitForSearchDebounce();

    expect(host.textContent).toContain("没有匹配的速记");

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
