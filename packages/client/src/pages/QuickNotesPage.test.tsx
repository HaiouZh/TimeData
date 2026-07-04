// @vitest-environment jsdom
import type { Category } from "@timedata/shared";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { setQuickNotePinned } from "../lib/quickNotes.js";
import { setPunchCategoryId } from "../lib/settings/punchCategorySetting.js";
import { setTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { db } from "../test/dbReset.js";
import { type Root, renderDom, unmount } from "../test/domHarness.js";
import QuickNotesPage from "./QuickNotesPage.js";

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

async function renderPage(initialEntry = "/quick-notes"): Promise<{ host: HTMLElement; root: Root }> {
  const { host, root } = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(BottomNavProvider, null, createElement(BottomNavStateProbe), createElement(QuickNotesPage)),
    ),
  );
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
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
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
    (element) => element.textContent?.includes(label) ?? false,
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

function composerButton(host: HTMLElement, label: string): HTMLButtonElement {
  const form = host.querySelector('form[aria-label="速记输入区"]');
  if (!(form instanceof HTMLFormElement)) throw new Error("missing composer form");
  const button = form.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing composer button ${label}`);
  return button;
}

function markByText(host: HTMLElement, text: string): HTMLElement | null {
  return (
    (Array.from(host.querySelectorAll("mark")).find((element) => element.textContent === text) as
      | HTMLElement
      | undefined) ?? null
  );
}

function expectNoRetiredQuickNoteChrome(host: HTMLElement) {
  const html = host.innerHTML;
  expect(html).not.toContain("text-mod-");
  expect(html).not.toContain("bg-blue-600");
  expect(html.replace(/\s+/g, "")).not.toContain(">x<");
  expect(html).not.toMatch(/\b(?:bg|text|border)-slate-/);
  expect(html).not.toMatch(/\b(?:bg|text|border)-(?:sky|emerald|red)-/);
  expect(html).not.toContain("font-mono");
  expect(html).not.toContain("rgba(");
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
  await db.categories.bulkAdd([category("cat-work", "工作", null), category("cat-work-deep", "深度", "cat-work")]);
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
    await click(composerButton(host, "记录速记"));

    expect(host.textContent).toContain("一个想法");
    expect(input(host).value).toBe("");
    await expect(db.quickNotes.count()).resolves.toBe(1);
    await expect(db.timeEntries.count()).resolves.toBe(0);

    await unmount(root);
  });

  it("does not send empty text", async () => {
    const { host, root } = await renderPage();

    const composer = host.querySelector('form[aria-label="速记输入区"]');
    if (!(composer instanceof HTMLFormElement)) throw new Error("missing composer form");

    await typeInto(input(host), "   ");
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="记录速记"]')).toBeNull();

    await act(async () => {
      composer.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    await expect(db.quickNotes.count()).resolves.toBe(0);

    await unmount(root);
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

    await click(host.querySelector('[role="button"][aria-label*="只读单击"]'));

    expect(input(host).value).toBe("");
    expect(host.textContent).not.toContain("正在编辑");

    await unmount(root);
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
    await unmount(root);
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

    await unmount(root);
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
    const pendingBubble = host.querySelector('[role="button"][aria-label*="待上传"]');
    const uploadedBubble = host.querySelector('[role="button"][aria-label*="已上传"]');

    expect(pendingBubble?.querySelector('[aria-label="待上传"]')).not.toBeNull();
    expect(uploadedBubble?.querySelector('[aria-label="已上传"]')).not.toBeNull();

    await unmount(root);
  });

  it("keeps selection controls accessible without retired chrome classes", async () => {
    await db.quickNotes.add({
      id: "note-select",
      text: "进入多选",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await openMenu(host, "进入多选");
    await click(menuItem(host, "选择"));

    expect(host.querySelector('button[aria-label="退出多选"]')).toBeInstanceOf(HTMLButtonElement);
    expectNoRetiredQuickNoteChrome(host);

    await unmount(root);
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

    expect(host.querySelector('[aria-label="速记列表"] [role="button"][aria-label*="钉住我"]')).toBeNull();

    await click(host.querySelector('button[aria-label="查看置顶速记，1 条"]'));

    const pinnedRegion = host.querySelector('[aria-label="置顶速记"]');
    expect(pinnedRegion).toBeInstanceOf(HTMLElement);
    expect(pinnedRegion?.textContent).toContain("钉住我");
    expect(pinnedRegion?.closest('[aria-label="速记列表"]')).toBeNull();
    expect(host.querySelector('button[aria-label="关闭置顶速记"]')).toBeNull();

    await click(host.querySelector('button[aria-label="收起置顶速记，1 条"]'));

    expect(host.querySelector('[aria-label="置顶速记"]')).toBeNull();

    await unmount(root);
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

    await unmount(root);
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

    await unmount(root);
  });

  it("宽屏 composer 不为移动底栏预留底部空隙", async () => {
    stubScreenWidth(true);

    const { host, root } = await renderPage();
    const composer = host.querySelector('form[aria-label="速记输入区"]');

    expect(composer).toBeInstanceOf(HTMLFormElement);
    expect((composer as HTMLFormElement).style.bottom).toBe("0px");

    await unmount(root);
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

    await unmount(root);
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
    await click(composerButton(host, "保存速记"));

    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({
      text: "新文本",
      occurredAt: "2026-06-01T04:00:00.000Z",
    });

    await unmount(root);
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

    await unmount(root);
  });

  it("键盘 Enter 在气泡上打开操作菜单（非选择态）", async () => {
    await db.quickNotes.add({
      id: "note-kbd",
      text: "键盘打开",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    const bubble = Array.from(host.querySelectorAll('[role="button"]')).find((el) =>
      el.textContent?.includes("键盘打开"),
    ) as HTMLElement;
    await act(async () => {
      bubble.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();

    expect(host.querySelector('[role="menu"][aria-label="速记操作"]')).toBeInstanceOf(HTMLElement);
    await unmount(root);
  });

  it("键盘 Escape 关闭已打开的操作菜单", async () => {
    await db.quickNotes.add({
      id: "note-esc",
      text: "关我",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    await openMenu(host, "关我");
    expect(host.querySelector('[role="menu"][aria-label="速记操作"]')).toBeInstanceOf(HTMLElement);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();

    expect(host.querySelector('[role="menu"][aria-label="速记操作"]')).toBeNull();
    await unmount(root);
  });

  it("选择态下键盘 Enter 切换该条选中", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "note-sel",
        text: "选我",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "note-sel2",
        text: "还有我",
        occurredAt: "2026-06-01T04:01:00.000Z",
        createdAt: "2026-06-01T04:01:00.000Z",
        updatedAt: "2026-06-01T04:01:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();
    await openMenu(host, "选我");
    await click(menuItem(host, "选择"));

    const other = Array.from(host.querySelectorAll('[role="button"]')).find((el) =>
      el.textContent?.includes("还有我"),
    ) as HTMLElement;
    await act(async () => {
      other.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();

    expect(host.textContent).toContain("已选");
    expect(other.getAttribute("aria-pressed")).toBe("true");
    await unmount(root);
  });

  it("选择态下点 Markdown 链接只勾选、不跳转", async () => {
    await db.quickNotes.add({
      id: "note-link",
      text: "看[链接](https://example.com)这里",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    await openMenu(host, "链接");
    await click(menuItem(host, "选择"));

    const link = host.querySelector('a[href="https://example.com"]') as HTMLAnchorElement;
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link.dispatchEvent(clickEvent);
    });
    await flush();

    expect(clickEvent.defaultPrevented).toBe(true);
    await unmount(root);
  });

  it("桌面有文字选区时右键不劫持为自定义菜单", async () => {
    await db.quickNotes.add({
      id: "note-native-menu",
      text: "选我复制",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    const originalGetSelection = window.getSelection;
    window.getSelection = (() => ({ toString: () => "选我" })) as unknown as typeof window.getSelection;
    try {
      const bubble = Array.from(host.querySelectorAll('[role="button"]')).find((el) =>
        el.textContent?.includes("选我复制"),
      ) as HTMLElement;
      await act(async () => {
        bubble.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }));
      });
      await flush();
      expect(host.querySelector('[role="menu"][aria-label="速记操作"]')).toBeNull();
    } finally {
      window.getSelection = originalGetSelection;
    }
    await unmount(root);
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
    await unmount(root);
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

    await unmount(root);
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

    await unmount(root);
  });

  it("宽屏：输入法组合态回车不发送（IME 候选确认）", async () => {
    stubScreenWidth(true);
    const { host, root } = await renderPage();

    await typeInto(input(host), "组合中");
    await act(async () => {
      input(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    });
    await flush();
    // IME 组合态的回车用于确认候选，不应把半截文本提交成速记
    await expect(db.quickNotes.count()).resolves.toBe(0);
    expect(input(host).value).toBe("组合中");

    await unmount(root);
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

    await unmount(root);
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

    await unmount(root);
  });

  it("opens search mode with an empty-query hint and hides the bottom composer", async () => {
    const { host, root } = await renderPage();

    await click(composerButton(host, "搜索速记"));

    expect(host.querySelector('input[placeholder="搜索速记…"]')).toBeInstanceOf(HTMLInputElement);
    expect(host.textContent).toContain("空格分隔多个词");
    expect(host.querySelector('textarea[aria-label="速记输入"]')).toBeNull();

    await unmount(root);
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

    await click(composerButton(host, "搜索速记"));
    await typeIntoSearch(searchInput(host), "会议");
    await waitForSearchDebounce();

    expect(markByText(host, "会议")).toBeInstanceOf(HTMLElement);
    expect(markByText(host, "会议")?.className).toContain("bg-accent-soft");
    expect(host.textContent).not.toContain("买牛奶");

    await typeIntoSearch(searchInput(host), "不存在的词");
    await waitForSearchDebounce();

    expect(host.textContent).toContain("没有匹配的速记");

    vi.useRealTimers();
    await unmount(root);
  });

  it("closes search mode and restores the bottom composer", async () => {
    const { host, root } = await renderPage();

    await click(composerButton(host, "搜索速记"));
    await click(host.querySelector('button[aria-label="退出搜索"]'));

    expect(input(host)).toBeInstanceOf(HTMLTextAreaElement);
    expect(host.querySelector('input[placeholder="搜索速记…"]')).toBeNull();

    await unmount(root);
  });

  it("keeps secondary toolbar actions while search and punch move into the empty composer", async () => {
    const { host, root } = await renderPage();

    expect(host.querySelector('header button[aria-label="搜索速记"]')).toBeNull();
    expect(host.querySelector('header button[aria-label="打点（记录到现在）"]')).toBeNull();
    expect(host.querySelector('header button[aria-label="更多操作"]')).not.toBeNull();
    expect(composerButton(host, "搜索速记")).toBeInstanceOf(HTMLButtonElement);
    expect(composerButton(host, "打点（记录到现在）")).toBeInstanceOf(HTMLButtonElement);

    await unmount(root);
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

  it("空草稿时 composer 左侧打开搜索、右侧打点，顶部不再保留搜索按钮", async () => {
    const { host, root } = await renderPage();

    expect(composerButton(host, "搜索速记")).toBeInstanceOf(HTMLButtonElement);
    expect(composerButton(host, "打点（记录到现在）")).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector('header button[aria-label="搜索速记"]')).toBeNull();
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="存为待办"]')).toBeNull();
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="记录速记"]')).toBeNull();

    await click(composerButton(host, "搜索速记"));

    expect(host.querySelector('input[placeholder="搜索速记…"]')).toBeInstanceOf(HTMLInputElement);
    expect(host.textContent).toContain("空格分隔多个词");
    expect(host.querySelector('textarea[aria-label="速记输入"]')).toBeNull();

    await unmount(root);
  });

  it("有草稿时 composer 左侧存待办、右侧记录速记", async () => {
    const { host, root } = await renderPage();
    await typeInto(input(host), "买牛奶");

    expect(composerButton(host, "存为待办")).toBeInstanceOf(HTMLButtonElement);
    expect(composerButton(host, "记录速记")).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="搜索速记"]')).toBeNull();
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="打点（记录到现在）"]')).toBeNull();

    await click(composerButton(host, "记录速记"));

    await expect(db.quickNotes.count()).resolves.toBe(1);
    await expect(db.quickNotes.toArray()).resolves.toMatchObject([{ text: "买牛奶" }]);
    expect(input(host).value).toBe("");

    await typeInto(input(host), "放进任务池");
    await click(composerButton(host, "存为待办"));

    await expect(db.tasks.toArray()).resolves.toMatchObject([{ title: "放进任务池", done: false }]);
    expect(input(host).value).toBe("");

    await unmount(root);
  });

  it("编辑中 composer 左侧取消、右侧保存，并覆盖普通状态按钮", async () => {
    await db.quickNotes.add({
      id: "note-edit",
      text: "旧文本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await openMenu(host, "旧文本");
    await click(menuItem(host, "编辑"));

    expect(composerButton(host, "取消编辑")).toBeInstanceOf(HTMLButtonElement);
    expect(composerButton(host, "保存速记")).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="搜索速记"]')).toBeNull();
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="存为待办"]')).toBeNull();
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="打点（记录到现在）"]')).toBeNull();
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="记录速记"]')).toBeNull();

    await typeInto(input(host), "新文本");
    await click(composerButton(host, "保存速记"));

    await expect(db.quickNotes.get("note-edit")).resolves.toMatchObject({ text: "新文本" });

    await openMenu(host, "新文本");
    await click(menuItem(host, "编辑"));
    await typeInto(input(host), "不保存的文本");
    await click(composerButton(host, "取消编辑"));

    expect(input(host).value).toBe("");
    await expect(db.quickNotes.get("note-edit")).resolves.toMatchObject({ text: "新文本" });

    await unmount(root);
  });

  it("空草稿时只有 composer 提供打点入口，顶部不再显示打点按钮", async () => {
    const { host, root } = await renderPage();

    const punchButtons = host.querySelectorAll('button[aria-label="打点（记录到现在）"]');
    expect(punchButtons).toHaveLength(1);
    expect(host.querySelector('header button[aria-label="打点（记录到现在）"]')).toBeNull();
    expect(host.querySelector('form[aria-label="速记输入区"] button[aria-label="打点（记录到现在）"]')).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(host.textContent).not.toContain("当前窗口");

    await unmount(root);
  });

  it("点「待办」把输入文本存成池任务并清空输入", async () => {
    const { host, root } = await renderPage();
    await typeInto(input(host), "买牛奶");

    const todoButton = composerButton(host, "存为待办");
    await click(todoButton);

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "买牛奶", done: false });
    expect(input(host).value).toBe("");

    await unmount(root);
  });

  it("连续点「待办」只保存一条任务", async () => {
    const { host, root } = await renderPage();
    await typeInto(input(host), "只存一次");

    const todoButton = composerButton(host, "存为待办");
    await act(async () => {
      todoButton.click();
      todoButton.click();
    });
    await flush();

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "只存一次" });

    await unmount(root);
  });

  it("存为待办成功反馈内嵌在 composer 内", async () => {
    const { host, root } = await renderPage();
    await typeInto(input(host), "买牛奶");
    await click(composerButton(host, "存为待办"));

    const feedback = host.querySelector('[aria-label="捕捉操作反馈"]');
    const composer = host.querySelector('form[aria-label="速记输入区"]');

    expect(composer?.contains(feedback)).toBe(true);
    expect(host.querySelector('[data-action-toast-overlay="true"]')).toBeNull();
    expect(feedback?.textContent).toContain("已加入今天");
    expect(feedback?.textContent).toContain("去待办");

    await unmount(root);
  });

  it("点「打点」建一条已配置分类的时间记录", async () => {
    await configurePunchCategory();
    const { host, root } = await renderPage();

    const punchButton = composerButton(host, "打点（记录到现在）");
    await click(punchButton);

    const entries = await db.timeEntries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].categoryId).toBe("cat-work-deep");

    await unmount(root);
  });

  it("打点连点只写一条记录（并发守卫）", async () => {
    await configurePunchCategory();
    const { host, root } = await renderPage();

    const punchButton = composerButton(host, "打点（记录到现在）");
    // 在第一次落库前连点两次：无守卫时两次都读到同一 lastEntry、各写一条重叠记录。
    await act(async () => {
      punchButton?.click();
      punchButton?.click();
    });
    await flush();

    await expect(db.timeEntries.count()).resolves.toBe(1);

    await unmount(root);
  });

  it("打点成功反馈内嵌在 composer 内，不再底部浮层覆盖列表", async () => {
    await configurePunchCategory();
    const { host, root } = await renderPage();
    await click(composerButton(host, "打点（记录到现在）"));

    const feedback = host.querySelector('[aria-label="捕捉操作反馈"]');
    const composer = host.querySelector('form[aria-label="速记输入区"]');

    expect(composer?.contains(feedback)).toBe(true);
    expect(host.querySelector('[data-action-toast-overlay="true"]')).toBeNull();
    expect(feedback?.textContent).toContain("已打点");
    expect(feedback?.textContent).toContain("撤销");

    await unmount(root);
  });

  it("速记「待办」按钮按默认落点：inbox 时新任务无排期", async () => {
    await db.settings.clear();
    await setTodoDefaultDestination("inbox");

    const { host, root } = await renderPage();
    await typeInto(input(host), "丢进收件箱");

    const todoBtn = composerButton(host, "存为待办");
    await click(todoBtn);

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].scheduledAt).toBeNull();

    await unmount(root);
  });
});
