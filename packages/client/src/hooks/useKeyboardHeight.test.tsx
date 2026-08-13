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
  // innerHeight 由各用例经 defineProperty 改写且不会自动还原，逐例复位到 jsdom 默认值，
  // 否则「壳缩过」的残留值会让后一个用例算出非零 shrink。
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
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

  it("keyboardHeight 非有限值（NaN/undefined）时归零而非透传 NaN", async () => {
    getPlatformMock.mockReturnValue("ios");
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: Number.NaN });
    });
    expect(readHeight(host)).toBe("0");

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: undefined });
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("非 web 平台照常订阅插件事件（visualViewport 在场也不改这一点）", async () => {
    getPlatformMock.mockReturnValue("android");
    addListenerMock.mockReturnValue(Promise.resolve({ remove: vi.fn() }));
    const viewport = createViewportMock({ height: 500, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;

    const { root } = await renderDom(createElement(Probe));
    expect(addListenerMock).toHaveBeenCalledTimes(2);

    await unmount(root);
  });
});

describe("useKeyboardHeight — 壳已经让过位时不再重复避让", () => {
  function mockNativeKeyboard() {
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    addListenerMock.mockImplementation((eventName: string, cb: (arg?: unknown) => void) => {
      callbacks[eventName] = cb;
      return Promise.resolve({ remove: vi.fn() });
    });
    return callbacks;
  }

  function setInnerHeight(value: number) {
    Object.defineProperty(window, "innerHeight", { value, configurable: true });
  }

  it("壳把 webview 缩掉一个键盘高（innerHeight 变小）时，JS 侧避让收敛为 0", async () => {
    // 双倍避让的根因：插件报 300，而壳已经把布局视口底抬到键盘之上，JS 再加 300 就把输入条
    // 顶到屏幕上半部分。这里钉住「壳让过位就不再重复加」。
    getPlatformMock.mockReturnValue("android");
    setInnerHeight(800);
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    // 壳还没 reflow：此刻无从判断，按插件高度抬起（不缩的壳这就是终值）。
    expect(readHeight(host)).toBe("300");

    // 壳缩了 webview → window resize。
    setInnerHeight(500);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("壳缩过一次后，下一次弹起首帧就不再冲高（不抖）", async () => {
    getPlatformMock.mockReturnValue("android");
    setInnerHeight(800);
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    setInnerHeight(500);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(readHeight(host)).toBe("0");

    // 收起：壳恢复全高，基线随之回到 800。
    await act(async () => {
      callbacks.keyboardWillHide?.();
    });
    setInnerHeight(800);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(readHeight(host)).toBe("0");

    // 再次弹起，壳尚未 reflow：按上次实测到的缩量预扣，首帧即 0，不再先冲到 300 再落回。
    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readHeight(host)).toBe("0");

    await unmount(root);
  });

  it("native 平台上 visualViewport 实测到的遮挡量优先于插件高度", async () => {
    // 壳把视口整体上移（WKWebView 的 scroll-to-focus）而非缩小时，innerHeight 不变、
    // 实测 gap 才说得出真相；插件高度此时是过量的。
    getPlatformMock.mockReturnValue("ios");
    setInnerHeight(800);
    const viewport = createViewportMock({ height: 620, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    // 实测：800 - 620 - 0 = 180 被遮，而插件报 300。以实测为准。
    expect(readHeight(host)).toBe("180");

    await unmount(root);
  });

  it("visualViewport 报不出遮挡（gap 在阈值内）时，回落到插件高度", async () => {
    // iOS resize:none 下 WebKit 可能既不缩 webview 也不更新 visualViewport，
    // 此时实测为 0 而键盘确实在遮——必须由插件高度兜底，否则输入条被键盘盖住。
    getPlatformMock.mockReturnValue("ios");
    setInnerHeight(800);
    const viewport = createViewportMock({ height: 800, offsetTop: 0 });
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const callbacks = mockNativeKeyboard();

    const { host, root } = await renderDom(createElement(Probe));

    await act(async () => {
      callbacks.keyboardWillShow?.({ keyboardHeight: 300 });
    });
    expect(readHeight(host)).toBe("300");

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
