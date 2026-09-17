// @vitest-environment jsdom
import type { Category } from "@timedata/shared";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter, useSearchParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { addQuickNote, setQuickNotePinned } from "../lib/quickNotes.js";
import { setPunchCategoryId } from "../lib/settings/punchCategorySetting.js";
import { setTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { getDateString } from "../lib/time.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { db } from "../test/dbReset.js";
import { type Root, renderDom, unmount } from "../test/domHarness.js";
import QuickNotesPage, { STICKY_TOP_PX, STUCK_HIDE_DELAY_MS } from "./QuickNotesPage.js";

vi.mock("../quick-notes/fileDownload.ts", () => ({
  downloadQuickNotesJson: vi.fn(async () => {}),
  downloadQuickNotesMarkdown: vi.fn(async () => {}),
}));

function BottomNavStateProbe() {
  const { hidden } = useBottomNav();
  return createElement("span", { "data-testid": "bottom-nav-hidden" }, String(hidden));
}

function SearchParamsProbe() {
  const [params] = useSearchParams();
  return createElement("span", { "data-testid": "date-param" }, params.get("date") ?? "");
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
      createElement(
        BottomNavProvider,
        null,
        createElement(BottomNavStateProbe),
        createElement(SearchParamsProbe),
        createElement(QuickNotesPage),
      ),
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

function searchResultCards(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll("[data-note-id]"));
}

function locateButtonIn(card: Element | null): HTMLButtonElement | null {
  return card?.querySelector('button[aria-label="定位到时间线"]') ?? null;
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
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // 用例内 defineProperty 装的 clipboard 不删会在 isolate:false 下泄漏给同 worker 的后续文件，
  // 改变它们对 navigator.clipboard 缺席的假设（如 TaskRow 的复制失败路径）。桩恒 configurable:true，
  // 置 undefined 与 delete 等价（消费方都走 falsy 判断），且不触发 noDelete 规则。
  (navigator as { clipboard?: unknown }).clipboard = undefined;
});

// 这个文件是页面级 jsdom 用例，整套跑 70s+，最慢一条（搜索截断上限那组）在空闲机器上就要 4.4s，
// 已占满 vitest 默认 5s 预算的 87%。全量 `pnpm test` 并行跑时 CPU 争抢会把它顶过线，表现为间歇性
// "Test timed out in 5000ms"——不是逻辑 flake，同一提交聚焦重跑必绿。按文件抬高上限，不动分桶默认值：
// 别的文件不该借这个口子变慢。
const PAGE_TEST_TIMEOUT_MS = 20_000;

describe("QuickNotesPage", () => {
  it("挂载时恢复未发出的草稿，并说明它是恢复来的", async () => {
    localStorage.setItem(STORAGE_KEYS.quickNoteComposerDraft, "写了一半");

    const { host, root } = await renderPage();

    expect(input(host).value).toBe("写了一半");
    // 必须说一声：否则用户不知道输入框为什么有字，也不知道左键此刻是「存为待办」不是「搜索」
    expect(host.textContent).toContain("已恢复未发出的草稿");
    expect(host.querySelector("[data-tone='info']")).toBeInstanceOf(HTMLElement);
    expect(composerButton(host, "存为待办")).toBeInstanceOf(HTMLButtonElement);

    await unmount(root);
  });

  it("边打字边把草稿写进本地，发出后清掉", async () => {
    const { host, root } = await renderPage();

    // Dexie 的事务在 vitest fake timers 下会提前判定「已完成」，跨表二次写入随之炸穿——
    // 这与本 Task 要测的行为无关，故把会落库的提交动作放到 fake timers 窗口之外。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await typeInto(input(host), "正在写的半条");
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await flush();
      expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBe("正在写的半条");
    } finally {
      vi.useRealTimers();
    }

    await click(composerButton(host, "记录速记"));
    await expect(db.quickNotes.count()).resolves.toBe(1);
    expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBeNull();

    await unmount(root);
  });

  it("编辑旧速记不污染 compose 草稿，退出编辑那一刻也不污染", async () => {
    localStorage.setItem(STORAGE_KEYS.quickNoteComposerDraft, "原本的草稿");
    await db.quickNotes.add({
      id: "note-edit",
      text: "旧速记",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await openMenu(host, "旧速记");
    await click(menuItem(host, "编辑"));

    // Dexie 的事务在 vitest fake timers 下会提前判定「已完成」，跨表二次写入随之炸穿——
    // 这与本 Task 要测的行为无关，故把会落库的提交动作放到 fake timers 窗口之外。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await typeInto(input(host), "旧速记改过了");
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await flush();
      // 编辑态下 draftText 是速记正文，防抖不该把它当草稿写进去
      expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBe("原本的草稿");
    } finally {
      vi.useRealTimers();
    }

    await click(composerButton(host, "保存速记"));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await flush();
      // 退出编辑这一刻是时序陷阱的窗口：防抖值若还停在速记正文上就会污染草稿
      expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBe("原本的草稿");
      expect(input(host).value).toBe("原本的草稿");
    } finally {
      vi.useRealTimers();
    }

    await unmount(root);
  });

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
    expect((list as HTMLElement).style.paddingBottom).toBe("calc(164px + var(--safe-bottom))");

    await unmount(root);
  });

  it("宽屏 composer 不为移动底栏预留底部空隙", async () => {
    stubScreenWidth(true);

    const { host, root } = await renderPage();
    const composer = host.querySelector('form[aria-label="速记输入区"]');

    expect(composer).toBeInstanceOf(HTMLFormElement);
    expect((composer as HTMLFormElement).style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });

  it("键盘在场信号收起底栏；聚焦本身不收（TG 口径：聚焦到键盘出现之间一切原地不动）", async () => {
    // 收底栏统一由 useKeyboardNavCollapse 按「键盘在不在场」驱动（components/KeyboardDock.tsx）。
    // 本文件跑在 web 平台；R7 起 native 不收底栏，见 KeyboardDock.test「useKeyboardNavCollapse 按平台」。
    // web 平台的在场信号是 visualViewport 实测遮挡——装一个可控 viewport，缩一个键盘高即在场。
    const viewport = {
      height: 768,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    try {
      const { host, root } = await renderPage();
      const composerInput = input(host);

      expect(bottomNavHidden(host)).toBe("false");

      // 聚焦本身不收（此前的 composerFocused 预收已按 TG 口径去除——预收正是两页时序不一致的来源）。
      await act(async () => {
        composerInput.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
      await flush();
      expect(bottomNavHidden(host)).toBe("false");

      // 键盘在场（视口被遮超阈值）→ 收起。
      viewport.height = 400;
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
      await flush();
      expect(bottomNavHidden(host)).toBe("true");

      // 键盘离场 → 恢复。
      viewport.height = 768;
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
      await flush();
      expect(bottomNavHidden(host)).toBe("false");

      await unmount(root);
    } finally {
      (window as unknown as { visualViewport?: unknown }).visualViewport = undefined;
    }
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

  it("日期条跳转到选中的日期", async () => {
    // header 常驻跳转框已收掉（Task 5），入口改为当前日期条自身；先给目标日种一条速记
    // 才有分隔条可点——沿用「主线日期条」describe 里同一套 trigger 选择器。
    await db.quickNotes.add({
      id: "jump-anchor",
      text: "跳转锚点",
      occurredAt: "2026-06-20T04:00:00.000Z",
      createdAt: "2026-06-20T04:00:00.000Z",
      updatedAt: "2026-06-20T04:00:00.000Z",
    });
    const { host, root } = await renderPage("/quick-notes?date=2026-06-20");

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-local-date="2026-06-20"] button[aria-label*="点击跳转到其他日期"]',
    );
    if (!trigger) throw new Error("missing jump date trigger");
    await click(trigger);
    await click(document.body.querySelector('button[aria-label="2026-06-01"]'));
    await flush();

    expect(host.querySelector('[data-testid="date-param"]')?.textContent).toBe("2026-06-01");
    await unmount(root);
  });

  it("日期跳转后把目标日期分隔条滚到视口顶部", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    await db.quickNotes.bulkAdd([
      {
        id: "early",
        text: "六月一日那条",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "late",
        text: "六月二十日那条",
        occurredAt: "2026-06-20T04:00:00.000Z",
        createdAt: "2026-06-20T04:00:00.000Z",
        updatedAt: "2026-06-20T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    try {
      await click(
        host.querySelector('[data-local-date="2026-06-01"] button[aria-label*="点击跳转到其他日期"]'),
      );
      await click(document.body.querySelector('button[aria-label="2026-06-20"]'));
      await flush();

      expect(scrolled.some((el) => el.getAttribute("data-local-date") === "2026-06-20")).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      await unmount(root);
    }
  });

  it("跳到没有速记的日期时回到列表顶（顶部即该日之后最近的内容）", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    await db.quickNotes.bulkAdd([
      {
        id: "early",
        text: "六月一日那条",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "late",
        text: "六月二十日那条",
        occurredAt: "2026-06-20T04:00:00.000Z",
        createdAt: "2026-06-20T04:00:00.000Z",
        updatedAt: "2026-06-20T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    try {
      const list = host.querySelector('[aria-label="速记列表"]');
      if (!(list instanceof HTMLElement)) throw new Error("missing list");
      list.scrollTop = 480;
      // 防假绿：确认 jsdom 保存了赋值，后面的归零断言才有意义
      expect(list.scrollTop).toBe(480);

      await click(
        host.querySelector('[data-local-date="2026-06-01"] button[aria-label*="点击跳转到其他日期"]'),
      );
      await click(document.body.querySelector('button[aria-label="2026-06-10"]'));
      await flush();

      expect(list.scrollTop).toBe(0);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      await unmount(root);
    }
  });

  it("退出搜索后 URL 日期归位到今天", async () => {
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");
    try {
      expect(host.querySelector('[data-testid="date-param"]')?.textContent).toBe("2026-06-01");

      await click(composerButton(host, "搜索速记"));
      await click(host.querySelector('button[aria-label="退出搜索"]'));

      expect(host.querySelector('[data-testid="date-param"]')?.textContent).toBe("");
    } finally {
      await unmount(root);
    }
  });

  it("多选导出 Markdown 走到真正的下载", async () => {
    // 按天导出退役后，速记页只剩多选这一条导出路径——它原先只有「菜单能打开」的覆盖，
    // 没人守到落文件这一步，这里补上，别让整条链路随按天导出一起失去闸。
    const downloads = await import("../quick-notes/fileDownload.ts");
    const today = getDateString(new Date());
    await addQuickNote("a", { occurredAt: `${today}T03:00:00.000Z`, now: new Date(`${today}T04:00:00.000Z`) });
    await addQuickNote("b", { occurredAt: `${today}T03:10:00.000Z`, now: new Date(`${today}T04:00:00.000Z`) });

    const { host, root } = await renderPage();
    try {
      await openMenu(host, "a");
      await click(menuItem(host, "选择"));
      await click(lastButtonByText(host, "全选"));
      expect(host.textContent).toContain("已选 2 条");

      await click(lastButtonByText(host, "导出"));
      await click(menuItem(host, "Markdown"));

      expect(host.textContent).toContain("已导出 Markdown");
      expect(downloads.downloadQuickNotesMarkdown).toHaveBeenCalledTimes(1);
    } finally {
      await unmount(root);
    }
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

  it("搜索跨天命中时按天插入日期分隔条", async () => {
    const today = getDateString(new Date());
    await addQuickNote("苹果 今天", {});
    await addQuickNote("苹果 上月", { occurredAt: "2026-05-12T04:00:00.000Z" });
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "苹果");
      await waitForSearchDebounce();

      const dividers = Array.from(host.querySelectorAll("[data-search-date]")).map((el) =>
        el.getAttribute("data-search-date"),
      );
      expect(dividers).toEqual([today, "2026-05-12"]);
    } finally {
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("搜索超过 100 条只先渲染 100 条并给加载更多", async () => {
    for (let index = 0; index < 120; index++) {
      await addQuickNote(`香蕉 ${index}`, {
        occurredAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
      });
    }
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "香蕉");
      await waitForSearchDebounce();

      expect(searchResultCards(host)).toHaveLength(100);
      const more = host.querySelector('button[aria-label="加载更多搜索结果"]');
      expect(more?.textContent).toContain("20");
      await click(more);
      expect(searchResultCards(host)).toHaveLength(120);
      expect(host.querySelector('button[aria-label="加载更多搜索结果"]')).toBeNull();
    } finally {
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("搜索换词后截断上限重置回 100", async () => {
    for (let index = 0; index < 110; index++) {
      await addQuickNote(`梨子 ${index}`, {
        occurredAt: new Date(Date.UTC(2026, 5, 2, 0, 0, index)).toISOString(),
      });
    }
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "梨子");
      await waitForSearchDebounce();
      await click(host.querySelector('button[aria-label="加载更多搜索结果"]'));

      await typeIntoSearch(searchInput(host), "梨");
      await waitForSearchDebounce();
      expect(searchResultCards(host)).toHaveLength(100);
    } finally {
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("加载更多后点结果关闭搜索，再保词重开仍只先渲染 100 条", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    for (let index = 0; index < 120; index++) {
      await addQuickNote(`葡萄 ${index}`, {
        occurredAt: new Date(Date.UTC(2026, 5, 3, 0, 0, index)).toISOString(),
      });
    }
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "葡萄");
      await waitForSearchDebounce();
      await click(host.querySelector('button[aria-label="加载更多搜索结果"]'));
      expect(searchResultCards(host)).toHaveLength(120);

      await click(locateButtonIn(searchResultCards(host)[0]));
      await click(composerButton(host, "搜索速记"));

      expect(searchInput(host).value).toBe("葡萄");
      expect(searchResultCards(host)).toHaveLength(100);
      expect(host.querySelector('button[aria-label="加载更多搜索结果"]')).not.toBeNull();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("点搜索结果正文不跳转，搜索面板保持打开", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const target = await addQuickNote("蓝莓 目标", { occurredAt: "2026-05-20T04:00:00.000Z" });
    await addQuickNote("今天无关", {});
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "蓝莓");
      await waitForSearchDebounce();
      await click(host.querySelector(`[data-note-id="${target.id}"]`));

      // 还在搜索态：输入框在、词没丢、没有发生定位滚动
      expect(searchInput(host).value).toBe("蓝莓");
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("点搜索结果滚动高亮到那条且保留搜索词", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const target = await addQuickNote("西瓜 目标", { occurredAt: "2026-05-20T04:00:00.000Z" });
    await addQuickNote("今天无关", {});
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "西瓜");
      await waitForSearchDebounce();
      await click(locateButtonIn(host.querySelector(`[data-note-id="${target.id}"]`)));

      const card = host.querySelector(`[data-note-id="${target.id}"][role="button"]`);
      expect(card).not.toBeNull();
      expect(scrollSpy).toHaveBeenCalledWith({ block: "center" });
      expect(card?.className).toContain("ring-inset");

      await click(composerButton(host, "搜索速记"));
      expect(searchInput(host).value).toBe("西瓜");
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("搜索结果定位等待时间线跳转后再滚动最终卡片", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn(function (this: Element) {
      expect(this.getAttribute("data-note-id")).toBe(target.id);
    });
    Element.prototype.scrollIntoView = scrollSpy;
    const target = await addQuickNote("哈密瓜 目标", { occurredAt: "2026-05-22T04:00:00.000Z" });
    await addQuickNote("哈密瓜 当前窗口", {});
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "哈密瓜");
      await waitForSearchDebounce();
      await click(locateButtonIn(host.querySelector(`[data-note-id="${target.id}"]`)));

      const card = host.querySelector(`[data-note-id="${target.id}"][role="button"]`);
      expect(card).not.toBeNull();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(card?.className).toContain("ring-inset");
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("搜索结果定位高亮 1.5 秒后消失", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    const target = await addQuickNote("柚子 目标", { occurredAt: "2026-05-21T04:00:00.000Z" });
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "柚子");
      await waitForSearchDebounce();
      await click(locateButtonIn(host.querySelector(`[data-note-id="${target.id}"]`)));

      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      await flush();
      const card = host.querySelector(`[data-note-id="${target.id}"][role="button"]`);
      expect(card?.className).not.toContain("ring-inset");
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.useRealTimers();
      await unmount(root);
    }
  });

  it("点退出搜索主动关闭仍清词", async () => {
    await addQuickNote("桃子", {});
    const { host, root } = await renderPage();

    try {
      await click(composerButton(host, "搜索速记"));
      await typeIntoSearch(searchInput(host), "桃子");
      await click(host.querySelector('button[aria-label="退出搜索"]'));
      await click(composerButton(host, "搜索速记"));
      expect(searchInput(host).value).toBe("");
    } finally {
      await unmount(root);
    }
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
    const todayStr = getDateString(new Date());
    await addQuickNote("今日一条", {
      occurredAt: `${todayStr}T03:00:00.000Z`,
      now: new Date(`${todayStr}T04:00:00.000Z`),
    });
    const { host, root } = await renderPage();

    expect(host.querySelector("header")).toBeNull();
    expect(composerButton(host, "搜索速记")).toBeInstanceOf(HTMLButtonElement);
    expect(composerButton(host, "打点（记录到现在）")).toBeInstanceOf(HTMLButtonElement);

    await unmount(root);
  });

  it("编辑未保存时切去编辑另一条要先确认，取消则留在原来那条", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "note-a",
        text: "第一条",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "note-b",
        text: "第二条",
        occurredAt: "2026-06-01T05:00:00.000Z",
        createdAt: "2026-06-01T05:00:00.000Z",
        updatedAt: "2026-06-01T05:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();

    await openMenu(host, "第一条");
    await click(menuItem(host, "编辑"));
    await typeInto(input(host), "第一条改过了");

    await openMenu(host, "第二条");
    await click(menuItem(host, "编辑"));

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("放弃对上一条的修改");

    await click(lastButtonByText(host, "继续编辑"));

    // 取消 = 留在第一条，改动一个字都不许掉
    expect(input(host).value).toBe("第一条改过了");
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await unmount(root);
  });

  it("确认放弃后切到另一条，装载新目标的原文", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "note-a",
        text: "第一条",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "note-b",
        text: "第二条",
        occurredAt: "2026-06-01T05:00:00.000Z",
        createdAt: "2026-06-01T05:00:00.000Z",
        updatedAt: "2026-06-01T05:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();

    await openMenu(host, "第一条");
    await click(menuItem(host, "编辑"));
    await typeInto(input(host), "第一条改过了");

    await openMenu(host, "第二条");
    await click(menuItem(host, "编辑"));
    await click(lastButtonByText(host, "放弃修改"));

    expect(input(host).value).toBe("第二条");

    await unmount(root);
  });

  it("没改过就切换不弹确认（不过度拦截）", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "note-a",
        text: "第一条",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "note-b",
        text: "第二条",
        occurredAt: "2026-06-01T05:00:00.000Z",
        createdAt: "2026-06-01T05:00:00.000Z",
        updatedAt: "2026-06-01T05:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();

    await openMenu(host, "第一条");
    await click(menuItem(host, "编辑"));

    await openMenu(host, "第二条");
    await click(menuItem(host, "编辑"));

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(input(host).value).toBe("第二条");

    await unmount(root);
  });

  it("历史视图里发速记给成功反馈和回到最新的入口", async () => {
    // 满 50 条同日 + 一条更新的，jumpToDate 才会离开「最新」窗口
    await db.quickNotes.bulkAdd(
      Array.from({ length: 50 }, (_, index) => {
        const at = `2026-06-01T04:${String(index).padStart(2, "0")}:00.000Z`;
        return { id: `old-${index}`, text: `旧记录 ${index}`, occurredAt: at, createdAt: at, updatedAt: at };
      }),
    );
    await db.quickNotes.add({
      id: "newer",
      text: "更新的一条",
      occurredAt: "2026-06-20T04:00:00.000Z",
      createdAt: "2026-06-20T04:00:00.000Z",
      updatedAt: "2026-06-20T04:00:00.000Z",
    });
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    await typeInto(input(host), "在历史里记一条");
    await click(composerButton(host, "记录速记"));

    // "text" 未建 Dexie 索引，where().equals() 会抛 SchemaError，改用 filter 达到同样的校验目的
    await expect(db.quickNotes.filter((note) => note.text === "在历史里记一条").count()).resolves.toBe(1);
    const toast = host.querySelector('[aria-label="捕捉操作反馈"]');
    expect(toast?.textContent).toContain("已记录");
    expect(lastButtonByText(host, "回到最新")).toBeInstanceOf(HTMLButtonElement);

    await unmount(root);
  });

  it("在最新窗口发速记不出 toast（气泡本身就是反馈）", async () => {
    const { host, root } = await renderPage();

    await typeInto(input(host), "今天这条");
    await click(composerButton(host, "记录速记"));

    expect(host.querySelector('[aria-label="捕捉操作反馈"]')?.textContent ?? "").not.toContain("已记录");

    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("回到最新的过场", () => {
  // matchMedia 桩按查询串给值：只有 prefers-reduced-motion 那条按参数回答，其余（宽屏判定）恒 false。
  function stubReducedMotion(reduced: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: reduced && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })),
    );
  }

  // 一条速记 + 可跟踪的滚动几何：内容 5000 高、视口 800 高，底部 scrollTop = 4200；起点 0（离底超过两屏）。
  async function renderFarFromBottom() {
    await db.quickNotes.add({
      id: "n1",
      text: "最新窗口里的一条",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    const list = host.querySelector('[aria-label="速记列表"]');
    if (!(list instanceof HTMLElement)) throw new Error("missing quick notes list");
    let scrollTopValue = 0;
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 5000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 800 });
    // jsdom 没有 Element.scrollTo，装一个记录用的。
    const scrollTo = vi.fn();
    (list as HTMLElement & { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    // 上滑离底 → 浮标出现。
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await flush();
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="回到最新"]');
    if (!button) throw new Error("missing jump-to-latest button");
    return { host, root, list, button, scrollTo, readScrollTop: () => scrollTopValue };
  }

  it("已在最新窗口、离底超过两屏：先瞬移到离底两屏处，再 smooth 滚到底——不再一步硬切", async () => {
    stubReducedMotion(false);
    const { root, button, scrollTo, readScrollTop } = await renderFarFromBottom();

    await click(button);

    expect(readScrollTop()).toBe(4200 - 2 * 800);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 4200, behavior: "smooth" });

    await unmount(root);
  });

  it("系统减弱动态效果：一步瞬移到底，不调 smooth", async () => {
    stubReducedMotion(true);
    const { root, button, scrollTo, readScrollTop } = await renderFarFromBottom();

    await click(button);

    expect(readScrollTop()).toBe(4200);
    expect(scrollTo).not.toHaveBeenCalled();

    await unmount(root);
  });

  // 6月1日满 50 条 + 6月20日满 50 条：?date=2026-06-01 落到历史窗口，「回到最新」要换数据窗口。
  // 两个窗口刻意**同样是 1 天 + 50 条**——displayItems 条数（含日期分隔项）完全相等，真浏览器里
  // 7 天 + 50 条对 7 天 + 50 条就是这个局面；只要天数不等条数就会变、吸底 effect 就会碰巧再跑一次，
  // 闸就是假的。
  async function renderHistoryWindow() {
    const day = (localDate: string, prefix: string) =>
      Array.from({ length: 50 }, (_, index) => {
        const at = `${localDate}T04:${String(index).padStart(2, "0")}:00.000Z`;
        return { id: `${prefix}-${index}`, text: `${prefix} ${index}`, occurredAt: at, createdAt: at, updatedAt: at };
      });
    await db.quickNotes.bulkAdd([...day("2026-06-01", "旧记录"), ...day("2026-06-20", "新记录")]);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");
    const list = host.querySelector('[aria-label="速记列表"]');
    if (!(list instanceof HTMLElement)) throw new Error("missing quick notes list");
    const wrapper = list.firstElementChild;
    if (!(wrapper instanceof HTMLElement)) throw new Error("missing list wrapper");
    // jsdom 不排版：让 scrollHeight 跟着**渲染出来的内容**走（正文总长度当高度），历史窗口与最新
    // 窗口都是 50 条、条数一样但内容不同，只有内容变了高度才变——正是要卡的那个洞。
    let scrollTopValue = 0;
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => list.textContent?.length ?? 0 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 0 });
    // jsdom 没有 Element.animate，装一个记录用的；列表内层在换窗口前后是同一个节点。
    // 记下淡入那一刻列表里是什么内容：淡入必须发生在新窗口已经渲染出来之后，淡的是新列表。
    let textAtReveal = "";
    const animate = vi.fn(() => {
      textAtReveal = host.textContent ?? "";
    });
    (wrapper as HTMLElement & { animate: typeof animate }).animate = animate;
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="回到最新"]');
    if (!button) throw new Error("missing jump-to-latest button");
    return { host, root, list, button, animate, readScrollTop: () => scrollTopValue, readTextAtReveal: () => textAtReveal };
  }

  it("从历史窗口回到最新：新窗口落定后贴到**新内容**的底——两窗都是 50 条、条数不变也得贴", async () => {
    // 改动前就有的洞（真浏览器实测停在离底 3587px、浮标不消失）：吸底 effect 只认条数变化，而
    // atLatest 在新数据到达前就翻 true，effect 拿旧内容贴了一次底，新内容落下后没人再贴。
    stubReducedMotion(false);
    const { host, root, list, button, readScrollTop } = await renderHistoryWindow();
    expect(host.textContent).not.toContain("新记录");

    await click(button);
    await flush();

    expect(host.textContent).toContain("新记录");
    expect(readScrollTop()).toBe(list.scrollHeight);

    await unmount(root);
  });

  it("从历史窗口回到最新：新窗口落定那一刻列表整块淡入，淡的是新列表不是旧列表", async () => {
    stubReducedMotion(false);
    const { host, root, button, animate, readTextAtReveal } = await renderHistoryWindow();
    expect(host.textContent).not.toContain("新记录");

    await click(button);
    await flush();

    expect(host.textContent).toContain("新记录");
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(options.duration).toBe(150);
    expect(readTextAtReveal()).toContain("新记录");

    await unmount(root);
  });

  it("系统减弱动态效果：换窗口不做淡入", async () => {
    stubReducedMotion(true);
    const { host, root, button, animate } = await renderHistoryWindow();

    await click(button);
    await flush();

    expect(host.textContent).toContain("新记录");
    expect(animate).not.toHaveBeenCalled();

    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

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

    // 反向闸：没有 localStorage 草稿时不该出现「已恢复」提示。
    expect(host.textContent).not.toContain("已恢复");
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

  it("存为待办的提示条可以撤销：删掉任务并把文本放回输入框", async () => {
    const { host, root } = await renderPage();

    await typeInto(input(host), "误存的内容");
    await click(composerButton(host, "存为待办"));

    await expect(db.tasks.count()).resolves.toBe(1);
    expect(input(host).value).toBe("");

    await click(lastButtonByText(host, "撤销"));

    await expect(db.tasks.count()).resolves.toBe(0);
    expect(input(host).value).toBe("误存的内容");
    expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBe("误存的内容");

    await unmount(root);
  });

  it("撤销时输入框已有新内容就不覆盖它，只说明没回填", async () => {
    const { host, root } = await renderPage();

    await typeInto(input(host), "误存的内容");
    await click(composerButton(host, "存为待办"));
    // 撤销窗口里用户又开始打字
    await typeInto(input(host), "新打的字");

    await click(lastButtonByText(host, "撤销"));

    await expect(db.tasks.count()).resolves.toBe(0);
    expect(input(host).value).toBe("新打的字");
    expect(host.textContent).toContain("原文本未回填");

    await unmount(root);
  });

  it("撤销回填的文本要重新落盘，不能被防抖的 Object.is bail-out 卡死", async () => {
    const { host, root } = await renderPage();

    // 第一步：让防抖把「误存的内容」先落盘。用假时钟确定性跨过 400ms，不做真实等待；
    // 这一步只碰 localStorage，不触发任何 Dexie 写入，与 Dexie+fake timers 的既有冲突无关。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await typeInto(input(host), "误存的内容");
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await flush();
    } finally {
      vi.useRealTimers();
    }
    expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBe("误存的内容");

    // 第二步：存为待办、撤销都要落库（Dexie 事务），必须在真实时钟下做。两次点击之间
    // 没有任何显式等待，天然落在 400ms 防抖窗口内——这正是复现该问题所需要的时序。
    await click(composerButton(host, "存为待办"));
    await expect(db.tasks.count()).resolves.toBe(1);
    await click(lastButtonByText(host, "撤销"));
    await expect(db.tasks.count()).resolves.toBe(0);

    // 第三步：撤销之后再跨过一个完整防抖窗口——不涉及任何 Dexie 写入，用假时钟确定性推进。
    // 若同步落盘缺失，debouncedComposeDraft 从未真的变过（Object.is bail-out），写盘 effect
    // 永远不会再跑，localStorage 会永久停在 handleSaveTodo 清掉的那次，拿不回「误存的内容」。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await flush();
    } finally {
      vi.useRealTimers();
    }

    expect(localStorage.getItem(STORAGE_KEYS.quickNoteComposerDraft)).toBe("误存的内容");

    await unmount(root);
  });

  it("撤销时若已经切去编辑另一条速记，拒绝回填并保留任务，不污染编辑缓冲", async () => {
    await db.quickNotes.add({
      id: "note-other",
      text: "被编辑的速记",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await typeInto(input(host), "误存的内容");
    await click(composerButton(host, "存为待办"));
    await expect(db.tasks.count()).resolves.toBe(1);

    // toast 存活 6 秒，期间用户长按另一条速记进入编辑——「撤销」按钮仍挂在 composer 里。
    await openMenu(host, "被编辑的速记");
    await click(menuItem(host, "编辑"));
    expect(input(host).value).toBe("被编辑的速记");

    await click(lastButtonByText(host, "撤销"));

    await expect(db.tasks.count()).resolves.toBe(1);
    expect(input(host).value).toBe("被编辑的速记");
    expect(host.textContent).toContain("正在编辑速记，先退出编辑再撤销这条待办");

    await unmount(root);
  });

  it("撤销时若已切去编辑且编辑框已被清空，依然拒绝回填、不覆盖空缓冲、不删任务", async () => {
    await db.quickNotes.add({
      id: "note-other",
      text: "被编辑的速记",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await typeInto(input(host), "误存的内容");
    await click(composerButton(host, "存为待办"));
    await expect(db.tasks.count()).resolves.toBe(1);

    // toast 存活 6 秒，期间用户长按另一条速记进入编辑——「撤销」按钮仍挂在 composer 里。
    await openMenu(host, "被编辑的速记");
    await click(menuItem(host, "编辑"));
    // 与上一条用例唯一的差别：把编辑框清空（想重写这条速记），此时 draftTextRef.current.trim()
    // 为假。若守卫被误合并成 editingIdRef.current && draftTextRef.current.trim()，这里就会失效。
    await typeInto(input(host), "");
    expect(input(host).value).toBe("");

    await click(lastButtonByText(host, "撤销"));

    await expect(db.tasks.count()).resolves.toBe(1);
    expect(input(host).value).toBe("");
    expect(host.textContent).toContain("正在编辑速记，先退出编辑再撤销这条待办");

    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("多选 × 置顶（QN-09/11）", () => {
  beforeEach(async () => {
    await db.tasks.clear();
    await db.quickNotes.clear();
    await db.timeEntries.clear();
    await db.categories.clear();
    await db.syncLog.clear();
  });

  async function addNote(id: string, text: string, occurredAt: string) {
    await db.quickNotes.add({ id, text, occurredAt, createdAt: occurredAt, updatedAt: occurredAt });
  }

  async function seedPinned(id: string, text: string, occurredAt: string) {
    await addNote(id, text, occurredAt);
    await setQuickNotePinned(id, true, { now: new Date(occurredAt) });
    await db.syncLog.clear();
  }

  function pinnedCard(host: HTMLElement, text: string): HTMLElement {
    const region = host.querySelector('[aria-label="置顶速记"]');
    const card = Array.from(region?.querySelectorAll('[role="button"]') ?? []).find(
      (element) => element.textContent?.includes(text) ?? false,
    );
    if (!(card instanceof HTMLElement)) throw new Error(`missing pinned card ${text}`);
    return card;
  }

  it("从置顶浮层进多选：浮层保持打开，选中项可见可反选（QN-09 方向1）", async () => {
    await seedPinned("pin-1", "置顶甲", "2026-06-01T04:00:00.000Z");
    const { host, root } = await renderPage();

    await click(host.querySelector('button[aria-label="查看置顶速记，1 条"]'));
    await openMenu(host, "置顶甲");
    await click(menuItem(host, "选择"));

    expect(host.querySelector('button[aria-label="退出多选"]')).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector('[aria-label="置顶速记"]')).toBeInstanceOf(HTMLElement);
    const card = pinnedCard(host, "置顶甲");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("含置顶 1");

    await click(card);
    expect(pinnedCard(host, "置顶甲").getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).toContain("已选 0 条");

    await unmount(root);
  });

  it("主线进多选后可打开置顶浮层勾选置顶（QN-09 方向2）", async () => {
    await addNote("note-a", "普通条", "2026-06-01T04:00:00.000Z");
    await seedPinned("pin-2", "置顶乙", "2026-06-01T05:00:00.000Z");
    const { host, root } = await renderPage();

    await openMenu(host, "普通条");
    await click(menuItem(host, "选择"));
    expect(host.textContent).toContain("已选 1 条");

    await click(host.querySelector('header button[aria-label="查看置顶速记，1 条"]'));
    await click(pinnedCard(host, "置顶乙"));

    expect(host.textContent).toContain("已选 2 条");
    expect(host.textContent).toContain("含置顶 1");

    await unmount(root);
  });

  it("全选只吃已加载非置顶；取消全选保留置顶勾选（QN-11a）", async () => {
    await addNote("note-1", "第一条", "2026-06-01T04:00:00.000Z");
    await addNote("note-2", "第二条", "2026-06-01T05:00:00.000Z");
    await addNote("note-3", "第三条", "2026-06-02T04:00:00.000Z");
    await seedPinned("pin-3", "置顶丙", "2026-06-01T06:00:00.000Z");
    const { host, root } = await renderPage();

    await openMenu(host, "第一条");
    await click(menuItem(host, "选择"));
    await click(lastButtonByText(host, "全选"));

    expect(host.textContent).toContain("已选 3 条");
    expect(host.textContent).not.toContain("含置顶");

    await click(host.querySelector('header button[aria-label="查看置顶速记，1 条"]'));
    await click(pinnedCard(host, "置顶丙"));
    expect(host.textContent).toContain("已选 4 条");

    await click(lastButtonByText(host, "取消全选"));
    expect(host.textContent).toContain("已选 1 条");
    expect(host.textContent).toContain("含置顶 1");

    await unmount(root);
  });

  it("日期分隔条「选中这天」toggle 当天已加载速记（QN-11b）", async () => {
    await addNote("day1-a", "六一甲", "2026-06-01T04:00:00.000Z");
    await addNote("day1-b", "六一乙", "2026-06-01T05:00:00.000Z");
    await addNote("day2-a", "六二甲", "2026-06-02T04:00:00.000Z");
    const { host, root } = await renderPage();

    expect(host.querySelector('button[aria-label*="选中"]')).toBeNull();

    await openMenu(host, "六二甲");
    await click(menuItem(host, "选择"));

    const dayButton = host.querySelector('button[aria-label="选中6月1日的速记"]');
    await click(dayButton);
    expect(host.textContent).toContain("已选 3 条");

    await click(host.querySelector('button[aria-label="取消选中6月1日的速记"]'));
    expect(host.textContent).toContain("已选 1 条");

    await unmount(root);
  });


  it("多选态导出菜单按 Escape 关闭（QN-16）", async () => {
    await addNote("note-esc", "菜单条", "2026-06-01T04:00:00.000Z");
    const { host, root } = await renderPage();

    await openMenu(host, "菜单条");
    await click(menuItem(host, "选择"));
    await click(lastButtonByText(host, "导出"));
    expect(menuItem(host, "Markdown")).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menuItem(host, "Markdown")).toBeNull();

    await unmount(root);
  });

  it("批量删除的目标数与勾选数一致，置顶勾选后可见即可删（QN-09 防回归）", async () => {
    await addNote("note-x", "普通丁", "2026-06-01T04:00:00.000Z");
    await seedPinned("pin-4", "置顶戊", "2026-06-01T05:00:00.000Z");
    const { host, root } = await renderPage();

    await click(host.querySelector('button[aria-label="查看置顶速记，1 条"]'));
    await openMenu(host, "置顶戊");
    await click(menuItem(host, "选择"));
    await click(lastButtonByText(host, "删除"));

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除 1 条速记");

    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("主线日期条", () => {
  it("列表里每条日期条都是跳转入口，且带 sticky 判定所需的 data 属性", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "d1",
        text: "第一天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "d2",
        text: "第二天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();

    const dividers = Array.from(host.querySelectorAll<HTMLElement>("[data-date-label]"));
    expect(dividers.length).toBe(2);
    for (const divider of dividers) {
      expect(divider.classList.contains("quick-note-date-divider")).toBe(true);
      expect(divider.dataset.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 每条日期条自己就是入口——不再依赖那个只在滑动后短暂可见的浮胶囊。
      const trigger = divider.querySelector<HTMLButtonElement>('button[aria-label*="点击跳转到其他日期"]');
      expect(trigger).toBeInstanceOf(HTMLButtonElement);
    }

    // 点第一条日期条能开出自绘月历（不是原生 input[type=date]）。
    const firstTrigger = dividers[0].querySelector<HTMLButtonElement>('button[aria-label*="点击跳转到其他日期"]');
    await act(async () => {
      firstTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector('button[aria-label="2026-06-01"]')).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector('input[type="date"]')).toBeNull();

    await unmount(root);
  });

  // Telegram 双端同款：滑动时浮在顶上的那颗日期条点了不开日历（Android 浮动条 jumpToDate、iOS
  // stickDistanceFactor ≥ 0.5 时 navigateToFirstDateMessage），只有列表里原位那颗才开 Calendar。
  // 本仓浮动条与原位条是同一个 sticky 元素，只能在点击那一刻按几何分辨——判定区间与停手扫描同一个。
  it("粘顶（浮动）中的日期药丸点了不开月历，列表原位那颗照常开", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "f1",
        text: "浮动第一天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "f2",
        text: "原位第二天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const dividers = Array.from(host.querySelectorAll<HTMLElement>("[data-date-label]"));
    // jsdom 量不出布局，按「第一条已粘住、第二条还在下方原位」伪造几何（与停手隐身用例同一套）。
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    dividers[0].getBoundingClientRect = () => ({ top: -10, height: 20 }) as DOMRect;
    dividers[1].getBoundingClientRect = () => ({ top: 300, height: 20 }) as DOMRect;

    const stuckTrigger = dividers[0].querySelector<HTMLButtonElement>('button[aria-label*="点击跳转到其他日期"]');
    await act(async () => {
      stuckTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector('button[aria-label="2026-06-01"]')).toBeNull();

    const restingTrigger = dividers[1].querySelector<HTMLButtonElement>('button[aria-label*="点击跳转到其他日期"]');
    await act(async () => {
      restingTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector('button[aria-label="2026-06-02"]')).toBeInstanceOf(HTMLButtonElement);

    await unmount(root);
  });

  it("主线药丸走 DateField 的 bare 形态：只剩 .quick-note-date-pill，字段外观三件套一个不在", async () => {
    // 守的是一次真实回归：DateField 的字段外观（min-h-11 圆角方块 + 自带底色）曾经赢过
    // 调用处的药丸类，药丸被撑成 44px 高的方角块。工具类之间比的是生成 CSS 的先后、
    // 不是 class 串里的先后，所以「在 className 里覆盖」是赌运气——必须靠 bare 换掉基础类。
    // 漏传 bare 时下面两条断言会同时红。与搜索态同款由「sticky 偏移常量与 JSX 同步」里的用例守。
    await db.quickNotes.add({
      id: "p1",
      text: "药丸形态样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label*="点击跳转到其他日期"]');
    if (!trigger) throw new Error("missing date trigger");
    expect(trigger.className.split(/\s+/)).toContain("quick-note-date-pill");
    // 字段外观的三件套一个都不该在：撑高的 min-h-11、方角的 rounded-row、自带的 bg-surface-elevated。
    for (const fieldLook of ["min-h-11", "rounded-row", "bg-surface-elevated"]) {
      expect(trigger.className).not.toContain(fieldLook);
    }

    await unmount(root);
  });

  it("每天各自成一个 sticky 包含块——两天的日期条不共享父节点", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "a1",
        text: "六月一日上午",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "a2",
        text: "六月一日下午",
        occurredAt: "2026-06-01T08:00:00.000Z",
        createdAt: "2026-06-01T08:00:00.000Z",
        updatedAt: "2026-06-01T08:00:00.000Z",
      },
      {
        id: "b1",
        text: "六月二日",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();

    const dividers = Array.from(host.querySelectorAll<HTMLElement>("[data-date-label]"));
    expect(dividers.length).toBe(2);

    // 这条守的是 DOM 层级，不是样式：position:sticky 的约束框是元素的父级内容盒，同一父级下的
    // sticky 兄弟互不推挤。若两条日期条共享父节点（拍平渲染），滚过去的每条都会一直钉在 top-2、
    // 层层相叠，findStuckDivider 就会把窗口里最早那天误判成「眼前这天」，导出/清理打错日子。
    const parents = dividers.map((divider) => divider.parentElement);
    expect(parents[0]).toBeInstanceOf(HTMLElement);
    expect(parents[0]).not.toBe(parents[1]);

    // 每个包裹节点只装本天的气泡——否则「下一天的包裹把上一天的日期条顶出视口」的推挤时机是错的。
    const noteIdsIn = (element: Element | null) =>
      Array.from(element?.querySelectorAll<HTMLElement>("[data-note-id]") ?? []).map((node) => node.dataset.noteId);
    expect(noteIdsIn(parents[0])).toEqual(["a1", "a2"]);
    expect(noteIdsIn(parents[1])).toEqual(["b1"]);

    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("搜索结果长按", () => {
  // 用户 2026-09-17 报：搜索出来的条目没法长按操作，只能点定位跳过去才能操作。
  // 搜索结果卡片接主线气泡同一套长按 / 右键 / 键盘唤起菜单的接线；卡片本体仍不可**点击**。
  async function renderSearch(text: string, term: string) {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const target = await addQuickNote(text, { occurredAt: "2026-05-20T04:00:00.000Z" });
    await addQuickNote("今天无关", {});
    const { host, root } = await renderPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await click(composerButton(host, "搜索速记"));
    await typeIntoSearch(searchInput(host), term);
    await waitForSearchDebounce();
    const card = host.querySelector<HTMLElement>(`[data-note-id="${target.id}"]`);
    if (!card) throw new Error("missing search result card");
    return {
      host,
      root,
      target,
      card,
      scrollSpy,
      cleanup: async () => {
        Element.prototype.scrollIntoView = originalScrollIntoView;
        vi.useRealTimers();
        await unmount(root);
      },
    };
  }

  function menuLabels(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll('button[role="menuitem"]')).map((button) => button.textContent ?? "");
  }

  it("右键 / 长按搜索结果弹出四项菜单：复制、编辑、置顶、删除——没有「选择」", async () => {
    const { host, card, cleanup } = await renderSearch("蓝莓 目标", "蓝莓");
    try {
      await act(async () => {
        card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
      });
      await flush();

      expect(menuLabels(host)).toEqual(["复制", "编辑", "置顶", "删除"]);
      // 还在搜索态：弹菜单本身不把人拽离搜索流。
      expect(searchInput(host).value).toBe("蓝莓");
    } finally {
      await cleanup();
    }
  });

  it("键盘 Enter 在搜索结果上也能打开菜单——卡片是可聚焦的 role=button", async () => {
    const { host, card, cleanup } = await renderSearch("蓝莓 目标", "蓝莓");
    try {
      expect(card.getAttribute("role")).toBe("button");
      expect(card.tabIndex).toBe(0);
      await act(async () => {
        card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      await flush();

      expect(menuLabels(host)).toContain("复制");
    } finally {
      await cleanup();
    }
  });

  it("搜索态里复制：写入剪贴板后仍留在搜索态", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { host, card, cleanup } = await renderSearch("蓝莓 目标", "蓝莓");
    try {
      await act(async () => {
        card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
      });
      await flush();
      await click(menuItem(host, "复制"));

      expect(writeText).toHaveBeenCalledWith("蓝莓 目标");
      expect(searchInput(host).value).toBe("蓝莓");
      expect(host.querySelector(`[data-note-id="${card.dataset.noteId}"]`)).not.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("搜索态里编辑：先按「定位到时间线」那条路跳过去，再进入编辑、草稿是那条正文", async () => {
    const { host, target, card, scrollSpy, cleanup } = await renderSearch("蓝莓 目标", "蓝莓");
    try {
      await act(async () => {
        card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
      });
      await flush();
      await click(menuItem(host, "编辑"));
      await flush();

      // 退出了搜索（搜索输入框不在了、composer 回来了），定位滚动发生过，编辑框里是那条正文。
      expect(host.querySelector('input[aria-label="搜索速记"]')).toBeNull();
      expect(scrollSpy).toHaveBeenCalled();
      expect(input(host).value).toBe("蓝莓 目标");
      expect(host.querySelector(`[data-note-id="${target.id}"][role="button"]`)).not.toBeNull();
    } finally {
      await cleanup();
    }
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("搜索态日期条", () => {
  it("搜索结果的日期条同样粘顶，但不是跳转入口", async () => {
    await db.quickNotes.add({
      id: "s1",
      text: "可搜索的速记",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await click(host.querySelector<HTMLButtonElement>('button[aria-label="搜索速记"]'));
    // 输入框只有 placeholder 可定位，省略号是全角 U+2026，照抄别手打。
    const input = host.querySelector<HTMLInputElement>('input[placeholder="搜索速记…"]');
    if (!input) throw new Error("missing search input");

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "可搜索");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(300); // 搜索 debounce 200ms
    });
    await flush();

    const divider = host.querySelector<HTMLElement>("[data-search-date]");
    expect(divider).toBeInstanceOf(HTMLElement);
    expect(divider?.classList.contains("quick-note-date-divider")).toBe(true);
    // 纯展示：日期条内没有任何按钮，点它不会离开搜索。
    expect(divider?.querySelector("button")).toBeNull();

    vi.useRealTimers();
    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("sticky 偏移常量与 JSX 同步", () => {
  // 这条不是同义反复：STICKY_TOP_PX 是 findStuckDivider 判定区间的上界，必须等于日期条 sticky 的
  // 实际像素偏移，而那个偏移写在 JSX 的 `top-2` 类里。三处独立字面量（1 个 TS 常量 + 主线/搜索
  // 两处 className），改任一处而不同步，既不报错、也不 typecheck 失败、也没有别的用例会红——
  // 粘住判定会静默偏 N 像素（顶部那条落不进区间 → 日期条再不淡出、viewingDate 停更）。
  // 由常量派生类名（Tailwind 的 `top-{n}` = n × 0.25rem），任一处改动而不同步都会让它红。
  it("STICKY_TOP_PX 与主线、搜索两处日期条的 top-{n} 类保持同一个值", async () => {
    await db.quickNotes.add({
      id: "t1",
      text: "偏移同步样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const expectedTopClass = `top-${STICKY_TOP_PX / 4}`;
    const { host, root } = await renderPage();

    const mainDivider = host.querySelector<HTMLElement>("[data-date-label]");
    expect(mainDivider?.className.split(/\s+/)).toContain("sticky");
    expect(mainDivider?.className.split(/\s+/)).toContain(expectedTopClass);

    await click(host.querySelector<HTMLButtonElement>('button[aria-label="搜索速记"]'));
    const searchBox = host.querySelector<HTMLInputElement>('input[placeholder="搜索速记…"]');
    if (!searchBox) throw new Error("missing search input");

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchBox, "偏移");
      searchBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(300); // 搜索 debounce 200ms
    });
    await flush();
    vi.useRealTimers();

    const searchDivider = host.querySelector<HTMLElement>("[data-search-date]");
    expect(searchDivider?.className.split(/\s+/)).toContain("sticky");
    expect(searchDivider?.className.split(/\s+/)).toContain(expectedTopClass);

    await unmount(root);
  });

  // 上一条守的是「top-{n} 与常量同值」，这条守的是那个值在真浏览器里**真的等于粘住时的像素**：
  // Chrome 与 WebKit 都把 sticky 的约束矩形按滚动容器的**内容盒**算，容器自己带 padding-top 时，
  // `top: 8px` 的日期条会粘在离容器顶边 8 + padding-top 处（实测 py-5 → 28px），而
  // findStuckDivider 的区间上界仍是 8——粘顶那条永远落不进区间，.stuck 一次都打不上，药丸常驻；
  // blockPickerWhileFloating 共用同一区间，「浮动药丸点了不开日历」也一并失效。jsdom 不排版，
  // 量不出这 20px，只能在结构上锁死：顶部留白归列表内层，滚动容器自己不许带任何 padding-top。
  it("滚动容器自己不带 padding-top——否则 sticky 粘住的像素是 top + padding，STICKY_TOP_PX 就不是真值了", async () => {
    await db.quickNotes.add({
      id: "t2",
      text: "容器内距样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const topPaddingClasses = list.className.split(/\s+/).filter((c) => /^(p|py|pt)-/.test(c) || /^\[padding-top:/.test(c));
    expect(topPaddingClasses).toEqual([]);
    expect(list.style.paddingTop).toBe("");
    expect(list.style.padding).toBe("");

    await unmount(root);
  });

  // 主线药丸是 DateField(bare) 的触发钮、搜索态药丸是纯 div，两处观感必须同款；几何与颜色全在
  // index.css 的 .quick-note-date-pill 一个类里（对齐 Telegram Android），JSX 不再各写一串工具类——
  // 否则改一处漏一处，两态药丸静默分家。
  it("主线与搜索态的日期药丸只挂同一个 .quick-note-date-pill 类、class 串逐字一致", async () => {
    await db.quickNotes.add({
      id: "p1",
      text: "药丸同款样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();

    const mainPill = host.querySelector<HTMLElement>("[data-date-label] .quick-note-date-pill");
    expect(mainPill?.tagName).toBe("BUTTON");
    expect(mainPill?.textContent).toContain("6月1日");

    await click(host.querySelector<HTMLButtonElement>('button[aria-label="搜索速记"]'));
    const searchBox = host.querySelector<HTMLInputElement>('input[placeholder="搜索速记…"]');
    if (!searchBox) throw new Error("missing search input");

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchBox, "药丸");
      searchBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(300); // 搜索 debounce 200ms
    });
    await flush();
    vi.useRealTimers();

    const searchPill = host.querySelector<HTMLElement>("[data-search-date] .quick-note-date-pill");
    expect(searchPill?.tagName).toBe("DIV");
    expect(searchPill?.textContent).toContain("6月1日");

    // 观感类只允许这一个：边框 / 底色 / 字号 / 内距一律不在 JSX 里，否则两态药丸会分家。
    const visualClasses = (el: HTMLElement | null) =>
      (el?.className ?? "")
        .split(/\s+/)
        .filter((c) => /^(rounded-|border|bg-|px-|py-|text-|td-text-|font-)/.test(c))
        .sort();
    expect(visualClasses(mainPill)).toEqual([]);
    expect(visualClasses(searchPill)).toEqual([]);
    expect(searchPill?.className.split(/\s+/)).toEqual(["quick-note-date-pill"]);

    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("停手隐身", () => {
  it("打开页面一次都没滚也会到点隐身——隐身是停手时的常态，不是「滚过一次之后才有」", async () => {
    // 用户 2026-09-16 报的就是这个：停手扫描原先只从 handleScroll 排，用户不滚就永远等不到它
    // 消失，打开速记页药丸挂在顶上不走（退出多选 / 退出搜索 / 关掉日历之后同理，那几处只摘类、
    // 没人重排）。**这一条全程不派发任何 scroll 事件**——断言的正是「没有滚动也会扫描」。
    await db.quickNotes.bulkAdd([
      {
        id: "n1",
        text: "第一天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "n2",
        text: "第二天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const dividers = Array.from(host.querySelectorAll<HTMLElement>("[data-date-label]"));
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    dividers[0].getBoundingClientRect = () => ({ top: -10, height: 28 }) as DOMRect;
    dividers[1].getBoundingClientRect = () => ({ top: 300, height: 28 }) as DOMRect;

    await act(async () => {
      vi.advanceTimersByTime(STUCK_HIDE_DELAY_MS);
    });
    expect(dividers[0].classList.contains("stuck")).toBe(true);
    expect(dividers[1].classList.contains("stuck")).toBe(false);

    vi.useRealTimers();
    await unmount(root);
  });

  it("停手后粘住的日期条隐身，一开始滚动立刻现身", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "k1",
        text: "第一天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "k2",
        text: "第二天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const dividers = Array.from(host.querySelectorAll<HTMLElement>("[data-date-label]"));

    // jsdom 量不出真实布局，按「第一条已粘住、第二条还在下方」伪造几何。
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    dividers[0].getBoundingClientRect = () => ({ top: -10, height: 28 }) as DOMRect;
    dividers[1].getBoundingClientRect = () => ({ top: 300, height: 28 }) as DOMRect;

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    // 滚动中：谁都不隐身，粘住效果全靠 CSS sticky。
    expect(dividers[0].classList.contains("stuck")).toBe(false);

    // 停手多久才隐身：产品定 0.3s（TG Android 代码是 0.5s + 150ms 淡出、iOS 是停手即 0.4s 淡出，
    // 两端都不是 0.3；这是用户按手感拍的板，不是抄的）。网页版那套 1.2s 手感明显拖。
    expect(STUCK_HIDE_DELAY_MS).toBe(300);
    await act(async () => {
      vi.advanceTimersByTime(STUCK_HIDE_DELAY_MS - 1);
    });
    // 差 1ms 没到点：谁都不隐身。
    expect(dividers[0].classList.contains("stuck")).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    // 到点：粘住那条隐身，没粘住的照常可见。
    expect(dividers[0].classList.contains("stuck")).toBe(true);
    expect(dividers[1].classList.contains("stuck")).toBe(false);

    // 再次滚动：立刻摘掉隐身类，日期随 transition 淡入。这一条不测就等于没测——
    // 忘了摘类的实现会表现为「滚动时日期永远不出现」，而上面两条断言全绿。
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(dividers[0].classList.contains("stuck")).toBe(false);

    vi.useRealTimers();
    await unmount(root);
  });

  it("滑动途中每次 scroll 都重排定时器，不是各排各的陆续 fire", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "db1",
        text: "防抖第一天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "db2",
        text: "防抖第二天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const dividers = Array.from(host.querySelectorAll<HTMLElement>("[data-date-label]"));
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    dividers[0].getBoundingClientRect = () => ({ top: -10, height: 28 }) as DOMRect;
    dividers[1].getBoundingClientRect = () => ({ top: 300, height: 28 }) as DOMRect;

    // 两段各走 0.7 个延迟：单段不到点、累计已越过一个延迟——忘了 clearTimeout 的实现会在累计处 fire。
    const partial = Math.round(STUCK_HIDE_DELAY_MS * 0.7);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(partial);
    });
    // 手指还在动：第二次 scroll 必须把上一次排下的定时器清掉再重排。
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(partial);
    });
    // 忘了 clearTimeout 的实现：第一次 scroll 那个定时器已在累计 1.4 个延迟处 fire 过，这里就已隐身。
    // 退化后果是滑动途中日期条闪烁 + 全程反复 setState，正是这条防抖分支要消灭的东西。
    expect(dividers[0].classList.contains("stuck")).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(STUCK_HIDE_DELAY_MS - partial);
    });
    // 从最后一次 scroll 起算满一个延迟才隐身。
    expect(dividers[0].classList.contains("stuck")).toBe(true);

    vi.useRealTimers();
    await unmount(root);
  });

  it("搜索态停手后粘住的搜索日期条也隐身——不与同日结果行重影", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "sd1",
        text: "可搜索六月一日",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "sd2",
        text: "可搜索六月二日",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");

    await click(composerButton(host, "搜索速记"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await typeIntoSearch(searchInput(host), "可搜索");
    await waitForSearchDebounce();

    const searchDividers = Array.from(host.querySelectorAll<HTMLElement>("[data-search-date]"));
    expect(searchDividers.length).toBe(2);
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    for (const [index, node] of searchDividers.entries()) {
      node.getBoundingClientRect = () => ({ top: index === 0 ? -10 : 300, height: 28 }) as DOMRect;
    }

    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    vi.useRealTimers();

    // 扫描把选择器塌成 "[data-date-label]" 的实现在搜索态一个节点都选不到，粘顶那条永远不淡出。
    expect(searchDividers[0].classList.contains("stuck")).toBe(true);
    expect(searchDividers[1].classList.contains("stuck")).toBe(false);

    await unmount(root);
  });

  it("先滚出隐身再进多选：残留的隐身类必须摘掉，否则「选中这天」跟着隐身", async () => {
    await db.quickNotes.add({
      id: "sw1",
      text: "模式切换样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const divider = host.querySelector<HTMLElement>("[data-date-label]");
    if (!divider) throw new Error("missing date divider");
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    divider.getBoundingClientRect = () => ({ top: -10, height: 28 }) as DOMRect;

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    vi.useRealTimers();
    expect(divider.classList.contains("stuck")).toBe(true);

    // 已经隐身之后再进多选（既有那条多选用例是先进多选再滚，走不到这一支）。
    await openMenu(host, "模式切换样本");
    await click(menuItem(host, "选择"));

    // React 按 key 复用**同一个** DOM 节点、className 字符串也没变，所以 React 不会替你重写它——
    // 模式切换那条 effect 不摘类，新渲染出来的「选中这天」按钮就跟着一起隐身且点不到。
    expect(host.querySelector<HTMLElement>("[data-date-label]")).toBe(divider);
    expect(divider.classList.contains("stuck")).toBe(false);

    await unmount(root);
  });

  it("多选态下粘住的日期条不隐身——「选中这天」必须点得到", async () => {
    await db.quickNotes.add({
      id: "m1",
      text: "多选态样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");

    // 多选只能从气泡长按/右键菜单进（没有独立入口按钮）。文件里已有的 openMenu/menuItem/click
    // 辅助函数就是干这个的，照抄同款写法。
    await openMenu(host, "多选态样本");
    await click(menuItem(host, "选择"));

    const divider = host.querySelector<HTMLElement>("[data-date-label]");
    if (!divider) throw new Error("missing date divider");
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    divider.getBoundingClientRect = () => ({ top: -10, height: 28 }) as DOMRect;

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(divider.classList.contains("stuck")).toBe(false);

    vi.useRealTimers();
    await unmount(root);
  });

  it("停手倒计时途中进多选，定时器 fire 时也不隐身（守闭包冻结）", async () => {
    await db.quickNotes.add({
      id: "g1",
      text: "闭包守卫样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const divider = host.querySelector<HTMLElement>("[data-date-label]");
    if (!divider) throw new Error("missing date divider");
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    divider.getBoundingClientRect = () => ({ top: -10, height: 28 }) as DOMRect;

    // 慢步骤（开菜单要 flush 十轮宏任务）放在种定时器之前：延迟只有 0.3s，机器一忙它就先 fire 了。
    await openMenu(host, "闭包守卫样本");

    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 滚动种下定时器，此刻 selectionMode 还是 false —— 回调闭包冻结的就是这个值。
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    // 倒计时途中进多选（不再滚动，所以定时器不会被重设）。只做一次同步点击、不 flush，
    // 种定时器到下面那条断言之间不留真实等待。
    await act(async () => {
      menuItem(host, "选择")?.click();
    });
    // 这条用例的闸建立在「定时器还没 fire」之上：若上一步真实耗时超过 STUCK_HIDE_DELAY_MS，
    // shouldAdvanceTime 会让它提前 fire，坏实现打的类又被 3f 的清理摘掉，闸会静默变绿。
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => {
      vi.advanceTimersByTime(STUCK_HIDE_DELAY_MS * 5);
    });
    // 直接读 state 而非 ref 的实现会在这里打上 stuck，把「选中这天」藏掉。
    expect(host.querySelector<HTMLElement>("[data-date-label]")?.classList.contains("stuck")).toBe(false);

    vi.useRealTimers();
    await unmount(root);
  });

  it("日历打开期间粘住的日期条不隐身——月历不能失去锚点", async () => {
    await db.quickNotes.add({
      id: "p1",
      text: "日历态样本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage();
    const list = host.querySelector<HTMLElement>('[aria-label="速记列表"]');
    if (!list) throw new Error("missing quick notes list");
    const divider = host.querySelector<HTMLElement>("[data-date-label]");
    if (!divider) throw new Error("missing date divider");
    list.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
    // 月历只能从**原位**那颗药丸开出来（浮动中那颗点了不开，见「粘顶（浮动）中的日期药丸」用例），
    // 所以先按原位几何点开它、datePickerOpen 置真，再把几何切成粘顶态去滚。
    divider.getBoundingClientRect = () => ({ top: 300, height: 20 }) as DOMRect;
    await click(divider.querySelector<HTMLButtonElement>('button[aria-label*="点击跳转到其他日期"]'));
    expect(document.body.querySelector('button[aria-label="2026-06-01"]')).toBeInstanceOf(HTMLButtonElement);
    divider.getBoundingClientRect = () => ({ top: -10, height: 20 }) as DOMRect;

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    // 把实现里的 `pickerOpen ||` 去掉，这条必须变红。
    expect(host.querySelector<HTMLElement>("[data-date-label]")?.classList.contains("stuck")).toBe(false);

    vi.useRealTimers();
    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);

describe("常态顶栏", () => {
  it("常态不渲染顶栏，进多选才出现", async () => {
    await addQuickNote("普通条", {
      occurredAt: "2026-06-01T04:00:00.000Z",
      now: new Date("2026-06-01T04:30:00.000Z"),
    });
    const { host, root } = await renderPage();

    expect(host.querySelector("header")).toBeNull();

    await openMenu(host, "普通条");
    await click(menuItem(host, "选择"));
    expect(host.querySelector("header")).toBeInstanceOf(HTMLElement);

    await unmount(root);
  });

  it("顶栏没了也不留常驻的「跳转日期」输入框", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[aria-label="跳转日期"]')).toBeNull();
    await unmount(root);
  });

  it("日期条上不再挂任何按天操作入口", async () => {
    // 按天导出 / 清理已由 设置 → 数据 覆盖，速记页不再重复一份。日期条只剩跳转，
    // 多选态额外挂「选中这天」。
    await addQuickNote("普通条", {
      occurredAt: "2026-06-01T04:00:00.000Z",
      now: new Date("2026-06-01T04:30:00.000Z"),
    });
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    const divider = host.querySelector('[data-local-date="2026-06-01"]');
    expect(divider).not.toBeNull();
    const buttons = Array.from(divider?.querySelectorAll("button") ?? []).map(
      (b) => b.getAttribute("aria-label") ?? "",
    );
    expect(buttons).toEqual(["6月1日，点击跳转到其他日期"]);

    await unmount(root);
  });
}, PAGE_TEST_TIMEOUT_MS);
