// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn(() => "web"));
const addListenerMock = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: getPlatformMock,
  },
}));

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: addListenerMock,
  },
}));

import { useKeyboardHeight } from "./useKeyboardHeight.js";

function Probe() {
  const height = useKeyboardHeight();
  return createElement("div", { "data-keyboard-height": String(height) });
}

type ViewportListener = () => void;

function createViewportMock(initial: { height: number; offsetTop: number }) {
  const listeners: Record<"resize" | "scroll", ViewportListener[]> = { resize: [], scroll: [] };
  const viewport = {
    height: initial.height,
    offsetTop: initial.offsetTop,
    addEventListener: (event: "resize" | "scroll", cb: ViewportListener) => {
      listeners[event].push(cb);
    },
    removeEventListener: (event: "resize" | "scroll", cb: ViewportListener) => {
      listeners[event] = listeners[event].filter((l) => l !== cb);
    },
    fire(event: "resize" | "scroll") {
      for (const cb of [...listeners[event]]) cb();
    },
  };
  return viewport;
}

function readHeight(host: HTMLElement): string | null {
  return host.firstElementChild?.getAttribute("data-keyboard-height") ?? null;
}

beforeEach(() => {
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("web");
  addListenerMock.mockReset();
  (window as unknown as { visualViewport?: unknown }).visualViewport = undefined;
});

describe("useKeyboardHeight — native", () => {
  it("keyboardWillShow 给出真实高度，keyboardWillHide 归零", async () => {
    getPlatformMock.mockReturnValue("ios");
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });

    const { host, root } = await renderDom(createElement(Probe));

    expect(readHeight(host)).toBe("0");
    expect(addListenerMock).toHaveBeenCalledWith("keyboardWillShow", expect.any(Function));
    expect(addListenerMock).toHaveBeenCalledWith("keyboardWillHide", expect.any(Function));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readHeight(host)).toBe("300");

    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("非 web 平台不订阅 visualViewport", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockReturnValue(Promise.resolve({ remove: vi.fn() }));
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { root } = await renderDom(createElement(Probe));
    expect(addListenerMock).toHaveBeenCalledTimes(2);

    await unmount(root);
  });
});

describe("useKeyboardHeight — web 兜底", () => {
  it("visualViewport 差值超过阈值出正值，回落到阈值以下归零", async () => {
    getPlatformMock.mockReturnValue("web");
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const viewport = createViewportMock({ height: 750, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { host, root } = await renderDom(createElement(Probe));
    expect(readHeight(host)).toBe("0");
    expect(addListenerMock).not.toHaveBeenCalled();

    viewport.height = 500; // 800 - 500 - 0 = 300 > 80 阈值
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readHeight(host)).toBe("300");

    viewport.height = 750; // 800 - 750 - 0 = 50 < 80 阈值
    await act(async () => {
      viewport.fire("resize");
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("无 visualViewport 时始终为 0", async () => {
    getPlatformMock.mockReturnValue("web");
    (window as unknown as { visualViewport?: unknown }).visualViewport = undefined;

    const { host, root } = await renderDom(createElement(Probe));
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });
});
