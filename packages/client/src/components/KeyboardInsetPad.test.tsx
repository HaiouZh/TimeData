// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn((): string => "web"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: getPlatformMock } }));
vi.mock("@capacitor/keyboard", () => ({
  Keyboard: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}));
vi.mock("../lib/useIsWideScreen.ts", () => ({ useIsWideScreen: () => false }));

import { KeyboardInsetPad } from "./KeyboardInsetPad.js";
import { KeyboardInsetSlot } from "./KeyboardInsetSlot.js";

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
function HeavyList() {
  renders += 1;
  return createElement("ul", null, createElement("li", null, "row"));
}
/** 页面根的替身：把列表当 children 交给 Pad，自己不订阅键盘。 */
function Page({ children }: { children: ReactNode }) {
  return createElement(
    BottomNavProvider,
    null,
    createElement(
      KeyboardInsetPad,
      { inset: { barPx: 100, navOffsetBasePx: 49 }, minPx: 192, extraPx: 24, "data-testid": "pad" },
      children,
    ),
  );
}

beforeEach(() => {
  renders = 0;
  localStorage.clear();
  getPlatformMock.mockReturnValue("web");
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});

describe("KeyboardInsetPad", () => {
  it("键盘弹起只重渲染 Pad 本身：children 引用不变，列表渲染计数不增（刀 1 的闸）", async () => {
    const viewport = makeViewport(768);
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderDom(createElement(Page, null, createElement(HeavyList)));
    const pad = host.querySelector('[data-testid="pad"]') as HTMLElement;
    // 键盘不在场：bar 100 + nav 49 + kbd 0 = 149，+24 = 173 < minPx 192
    expect(pad.style.getPropertyValue("--pad-bottom")).toBe("192px");
    const before = renders;
    await act(async () => {
      viewport.height = 468; // 遮挡 300
      viewport.fire();
    });
    // web：settled 与即时同步；键盘在场 nav 归零：100 + 0 + 300 = 400，+24 = 424
    expect(pad.style.getPropertyValue("--pad-bottom")).toBe("424px");
    expect(pad.style.paddingBottom).toBe("calc(424px + var(--safe-bottom))");
    expect(renders).toBe(before);
    await unmount(root);
  });

  it("scrollPadding 时同步写 scrollPaddingBottom；as=section 渲染 section", async () => {
    (window as unknown as { visualViewport?: unknown }).visualViewport = makeViewport(768);
    const { host, root } = await renderDom(
      createElement(
        BottomNavProvider,
        null,
        createElement(
          KeyboardInsetPad,
          { as: "section", scrollPadding: true, inset: { barPx: 128, navOffsetBasePx: 0 }, "data-testid": "pad" },
          "x",
        ),
      ),
    );
    const pad = host.querySelector('[data-testid="pad"]') as HTMLElement;
    expect(pad.tagName).toBe("SECTION");
    expect(pad.style.scrollPaddingBottom).toBe("calc(128px + var(--safe-bottom))");
    await unmount(root);
  });
});

describe("KeyboardInsetSlot", () => {
  it("即时值随键盘立刻变；nav 在键盘在场时归零", async () => {
    const viewport = makeViewport(768);
    (window as unknown as { visualViewport?: unknown }).visualViewport = viewport;
    const { host, root } = await renderDom(
      createElement(
        BottomNavProvider,
        null,
        createElement(KeyboardInsetSlot, { inset: { barPx: 60, navOffsetBasePx: 49 } }, (px: number) =>
          createElement("div", { "data-testid": "slot", "data-px": String(px) }),
        ),
      ),
    );
    const read = () => host.querySelector('[data-testid="slot"]')?.getAttribute("data-px");
    expect(read()).toBe("109");
    await act(async () => {
      viewport.height = 468;
      viewport.fire();
    });
    expect(read()).toBe("360");
    await unmount(root);
  });
});
