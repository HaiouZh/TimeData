// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn((): string => "web"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: getPlatformMock } }));
vi.mock("@capacitor/keyboard", () => ({
  Keyboard: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}));

import { KeyboardInsetFrame } from "./KeyboardInsetFrame.js";

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

let renders = 0;
function HeavyEditor() {
  renders += 1;
  return createElement("textarea", { "data-testid": "editor" });
}

/** 页面根的替身：把整页内容当 children 交给 Frame，自己不订阅键盘（R8 §3.1）。 */
function Page({ navOffsetBasePx, children }: { navOffsetBasePx: number; children: ReactNode }) {
  return createElement(KeyboardInsetFrame, { navOffsetBasePx, "data-testid": "frame" }, children);
}

beforeEach(() => {
  renders = 0;
  getPlatformMock.mockReturnValue("web");
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});

describe("KeyboardInsetFrame（文档流页面容器的键盘让位）", () => {
  it("底栏在文档流里时让位量扣掉底栏占位——多让一个底栏高就是日记页那条黑条", async () => {
    const viewport = makeViewport(768);
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderDom(
      createElement(Page, { navOffsetBasePx: 49 }, createElement(HeavyEditor)),
    );
    const frame = host.querySelector('[data-testid="frame"]') as HTMLElement;
    // 键盘不在场：恒零让位
    expect(frame.style.paddingBottom).toBe("0px");
    await act(async () => {
      viewport.height = 468; // 遮挡 300
      viewport.fire();
    });
    // 键盘挡 300、底栏占 49：容器只需让开重叠的那段
    expect(frame.style.paddingBottom).toBe("max(0px, calc(300px - 49px - var(--safe-bottom)))");
    await unmount(root);
  });

  it("底栏不在场（宽屏 / 已隐）时让整个遮挡量", async () => {
    const viewport = makeViewport(768);
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderDom(createElement(Page, { navOffsetBasePx: 0 }, createElement(HeavyEditor)));
    const frame = host.querySelector('[data-testid="frame"]') as HTMLElement;
    await act(async () => {
      viewport.height = 468;
      viewport.fire();
    });
    expect(frame.style.paddingBottom).toBe("300px");
    await unmount(root);
  });

  it("键盘弹起只重渲染 Frame 本身：children 引用不变，编辑器渲染计数不增（R8 叶子化闸）", async () => {
    const viewport = makeViewport(768);
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderDom(
      createElement(Page, { navOffsetBasePx: 49 }, createElement(HeavyEditor)),
    );
    const before = renders;
    await act(async () => {
      viewport.height = 468;
      viewport.fire();
    });
    const frame = host.querySelector('[data-testid="frame"]') as HTMLElement;
    expect(frame.style.paddingBottom).not.toBe("0px");
    expect(renders).toBe(before);
    await unmount(root);
  });

  it("透传 className 与其余 div 属性，页面样式照旧挂在这一层", async () => {
    (window as unknown as { visualViewport?: unknown }).visualViewport = makeViewport(768);
    const { host, root } = await renderDom(
      createElement(
        KeyboardInsetFrame,
        { navOffsetBasePx: 0, className: "flex h-full flex-col bg-page", "data-testid": "frame" },
        "x",
      ),
    );
    const frame = host.querySelector('[data-testid="frame"]') as HTMLElement;
    expect(frame.className).toBe("flex h-full flex-col bg-page");
    await unmount(root);
  });
});
