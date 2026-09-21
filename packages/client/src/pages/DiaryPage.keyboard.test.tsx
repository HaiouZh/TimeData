// @vitest-environment jsdom
import { createElement, act as reactAct } from "react";
import { flushSync } from "react-dom";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn((): string => "web"));
const isWideScreenMock = vi.hoisted(() => vi.fn((): boolean => false));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: getPlatformMock, isNativePlatform: () => getPlatformMock() !== "web" },
}));
vi.mock("@capacitor/keyboard", () => ({
  Keyboard: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}));
vi.mock("../lib/useIsWideScreen.ts", () => ({ useIsWideScreen: () => isWideScreenMock() }));
vi.mock("../lib/diary/diaryApi.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/diary/diaryApi.js")>("../lib/diary/diaryApi.ts");
  return {
    ...actual,
    fetchDiaryConfig: () => Promise.resolve({ enabled: true, template: "1. ", weeklyTemplate: "", guideItems: "" }),
    fetchDiary: () => Promise.resolve({ content: "1. 今天", mtime: 1 }),
  };
});

import DiaryPage from "./DiaryPage.js";

function makeViewport(height: number) {
  const listeners: Array<() => void> = [];
  return {
    height,
    offsetTop: 0,
    addEventListener(_e: string, cb: () => void) {
      listeners.push(cb);
    },
    removeEventListener(_e: string, cb: () => void) {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    fire() {
      for (const cb of [...listeners]) cb();
    },
  };
}

async function act(callback: () => Promise<void> | void) {
  await reactAct(async () => {
    let result: Promise<void> | void;
    flushSync(() => {
      result = callback();
    });
    await result;
    flushSync(() => {});
  });
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  // data router：DiaryPage 用 useUnsavedChangesGuard（内部 useBlocker），MemoryRouter 下会抛。
  const router = createMemoryRouter([{ path: "/diary", element: createElement(DiaryPage) }], {
    initialEntries: ["/diary"],
  });
  const { host, root } = await renderDom(
    createElement(BottomNavProvider, null, createElement(RouterProvider, { router })),
  );
  await flush();
  return { host, root };
}

function frame(host: HTMLElement): HTMLElement {
  const element = host.querySelector('[data-testid="diary-frame"]');
  if (!(element instanceof HTMLElement)) throw new Error("missing diary frame");
  return element;
}

beforeEach(() => {
  getPlatformMock.mockReturnValue("web");
  isWideScreenMock.mockReturnValue(false);
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});

describe("日记页的键盘让位", () => {
  /**
   * 黑条本体闸（2026-09-21 真机报障 + Chrome 复现）：窄屏下底部导航是 flex 兄弟、实打实占 49px
   * 布局高，编辑器容器底边离屏幕底本来就有这一段。让位量照搬遮挡量就多让一个底栏高，textarea
   * 底边停在键盘上沿之上 49px，中间露出容器自己的 bg-page——真机即「输入法上方一行黑条」。
   */
  it("底栏在场时让位量扣掉底栏占位，不多让一个底栏高", async () => {
    const viewport = makeViewport(768);
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderPage();
    expect(frame(host).style.paddingBottom).toBe("0px");
    await act(async () => {
      viewport.height = 468; // 键盘挡 300
      viewport.fire();
    });
    expect(frame(host).style.paddingBottom).toBe("max(0px, calc(300px - 49px - var(--safe-bottom)))");
    await unmount(root);
  });

  it("宽屏没有底栏，容器底边就是屏幕底，让整个遮挡量", async () => {
    isWideScreenMock.mockReturnValue(true);
    const viewport = makeViewport(768);
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderPage();
    await act(async () => {
      viewport.height = 468;
      viewport.fire();
    });
    expect(frame(host).style.paddingBottom).toBe("300px");
    await unmount(root);
  });
});
