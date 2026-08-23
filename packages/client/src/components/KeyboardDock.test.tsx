// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
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

import { KeyboardDock } from "./KeyboardDock.js";

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
    createElement(
      BottomNavProvider,
      null,
      createElement(KeyboardDock, { "data-testid": "dock", ...props }, "内容"),
    ),
  );
}

function dockEl(host: HTMLElement): HTMLElement {
  return host.querySelector('[data-testid="dock"]') as HTMLElement;
}

describe("KeyboardDock", () => {
  it("键盘不在场：过渡提速到 200ms（IME 收起比弹出快半拍，250ms 落条会拖在后面）", async () => {
    mockNativeKeyboard();
    const { host, root } = await renderDock();
    expect(dockEl(host).style.transitionDuration).toBe("200ms");
    await unmount(root);
  });

  it("键盘在场：吃 .td-kbd-motion 默认 250ms（不覆写 duration），抬升 = 键盘高、nav 让位归零", async () => {
    const keyboard = mockNativeKeyboard();
    const { host, root } = await renderDock();

    await act(async () => {
      keyboard.fire("keyboardWillShow", { keyboardHeight: 300 });
    });
    const el = dockEl(host);
    expect(el.style.transform).toBe("translateY(-300px)");
    expect(el.style.transitionDuration).toBe("");
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
