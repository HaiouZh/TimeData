// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn((): string => "android"));
const addListenerMock = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: getPlatformMock },
}));
vi.mock("@capacitor/keyboard", () => ({
  Keyboard: { addListener: addListenerMock },
}));
vi.mock("../lib/useIsWideScreen.ts", () => ({
  useIsWideScreen: () => false,
}));

import { KeyboardDock, useKeyboardNavCollapse } from "./KeyboardDock.js";

function mockNativeKeyboard() {
  // dock 内两个 hook 实例（height / visible）各注册一份监听，得广播不能只留最后一个。
  const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
    listeners[eventName] = listeners[eventName] ?? [];
    listeners[eventName].push(cb);
    return Promise.resolve({ remove: vi.fn() });
  });
  return {
    fire(eventName: string, arg?: unknown) {
      for (const cb of listeners[eventName] ?? []) cb(arg);
    },
  };
}

function renderDock(props: Record<string, unknown> = {}) {
  return renderDom(
    createElement(BottomNavProvider, null, createElement(KeyboardDock, { "data-testid": "dock", ...props }, "内容")),
  );
}

function dockEl(host: HTMLElement): HTMLElement {
  return host.querySelector('[data-testid="dock"]') as HTMLElement;
}

describe("KeyboardDock", () => {
  beforeEach(() => {
    localStorage.clear();
    getPlatformMock.mockReturnValue("android");
  });

  it("键盘不在场：过渡用 hideMs；在场用 showMs；曲线按平台（Android 默认 285/285 SYNC_IME）", async () => {
    const keyboard = mockNativeKeyboard();
    const { host, root } = await renderDock();
    const el = dockEl(host);
    expect(el.style.transitionDuration).toBe("285ms");
    expect(el.style.transitionTimingFunction).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(el.getAttribute("data-kbd-dock")).toBe("1");

    await act(async () => {
      keyboard.fire("keyboardWillShow", { keyboardHeight: 300 });
    });
    expect(el.style.transform).toBe("translateY(-300px)");
    expect(el.style.transitionDuration).toBe("285ms");
    await unmount(root);
  });

  it("实测到的系统时长（localStorage）压过平台默认，收放各用各的", async () => {
    localStorage.setItem("timedata_keyboard_motion", JSON.stringify({ showMs: 300, hideMs: 180 }));
    const keyboard = mockNativeKeyboard();
    const { host, root } = await renderDock();
    const el = dockEl(host);
    expect(el.style.transitionDuration).toBe("180ms");
    await act(async () => {
      keyboard.fire("keyboardWillShow", { keyboardHeight: 300 });
    });
    expect(el.style.transitionDuration).toBe("300ms");
    await act(async () => {
      keyboard.fire("keyboardWillHide");
    });
    expect(el.style.transitionDuration).toBe("180ms");
    await unmount(root);
  });

  it("iOS 平台曲线换成 iOS 键盘曲线近似、默认 250/250", async () => {
    getPlatformMock.mockReturnValue("ios");
    mockNativeKeyboard();
    const { host, root } = await renderDock();
    const el = dockEl(host);
    expect(el.style.transitionDuration).toBe("250ms");
    expect(el.style.transitionTimingFunction).toBe("cubic-bezier(0.38, 0.7, 0.125, 1)");
    await unmount(root);
  });

  it("hiddenByScroll：整体 translateY(100%) 滑出视口，压过抬升", async () => {
    const keyboard = mockNativeKeyboard();
    const { host, root } = await renderDock({ hiddenByScroll: true });
    await act(async () => {
      keyboard.fire("keyboardWillShow", { keyboardHeight: 300 });
    });
    expect(dockEl(host).style.transform).toBe("translateY(100%)");
    await unmount(root);
  });
});

// ── useKeyboardNavCollapse：native 不收底栏（overlay 下它在键盘背后），web 保留 ─────────
function NavProbe() {
  useKeyboardNavCollapse();
  const { hidden } = useBottomNav();
  return createElement("div", { "data-testid": "nav", "data-hidden": String(hidden) });
}

function renderNavProbe() {
  return renderDom(createElement(BottomNavProvider, null, createElement(NavProbe)));
}

function navHidden(host: HTMLElement): string | null {
  return host.querySelector('[data-testid="nav"]')?.getAttribute("data-hidden") ?? null;
}

describe("useKeyboardNavCollapse 按平台", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(["android", "ios"] as const)("%s：键盘弹起不收底栏——收它只是动画期一次多余的布局动画", async (platform) => {
    getPlatformMock.mockReturnValue(platform);
    const keyboard = mockNativeKeyboard();
    const { host, root } = await renderNavProbe();
    expect(navHidden(host)).toBe("false");
    await act(async () => {
      keyboard.fire("keyboardWillShow", { keyboardHeight: 300 });
    });
    expect(navHidden(host)).toBe("false");
    await unmount(root);
  });

  it("web：键盘在场仍收底栏、离场恢复（iOS Safari 会滚文档让底栏露到键盘上方）", async () => {
    getPlatformMock.mockReturnValue("web");
    const viewport = {
      height: 768,
      offsetTop: 0,
      listeners: [] as Array<() => void>,
      addEventListener(_e: string, cb: () => void) {
        this.listeners.push(cb);
      },
      removeEventListener() {},
      fire() {
        for (const cb of [...this.listeners]) cb();
      },
    };
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderNavProbe();
    await act(async () => {
      viewport.height = 468;
      viewport.fire();
    });
    expect(navHidden(host)).toBe("true");
    await act(async () => {
      viewport.height = 768;
      viewport.fire();
    });
    expect(navHidden(host)).toBe("false");
    await unmount(root);
    (window as unknown as { visualViewport?: unknown }).visualViewport = undefined;
  });
});
