// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlatformMock = vi.hoisted(() => vi.fn((): string => "android"));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: getPlatformMock,
  },
}));

import { focusOnPointerDown } from "./fastFocus.js";

function makePointerDown(el: HTMLElement, pointerType: string) {
  return {
    pointerType,
    currentTarget: el,
    preventDefault: vi.fn(),
  } as unknown as Parameters<typeof focusOnPointerDown>[0];
}

describe("focusOnPointerDown", () => {
  let el: HTMLInputElement;

  beforeEach(() => {
    getPlatformMock.mockReturnValue("android");
    document.body.innerHTML = "";
    el = document.createElement("input");
    document.body.appendChild(el);
  });

  it("安卓触摸未聚焦：preventDefault + 立即 focus（快聚焦生效）", () => {
    const focusSpy = vi.spyOn(el, "focus");
    const event = makePointerDown(el, "touch");
    focusOnPointerDown(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("iOS 触摸：整条快聚焦路径跳过——不 preventDefault 不 focus，交还 WebKit 原生聚焦", () => {
    // 钉根因的护栏：pointerdown 里 preventDefault+focus 会让 WKWebView 把该触摸序列判成
    // cancelled，touchend 时 resign firstResponder——键盘闪现即收回（2026-08-22 真机症状）。
    getPlatformMock.mockReturnValue("ios");
    const focusSpy = vi.spyOn(el, "focus");
    const event = makePointerDown(el, "touch");
    focusOnPointerDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("鼠标：不拦截（桌面保留拖选起点语义）", () => {
    const focusSpy = vi.spyOn(el, "focus");
    const event = makePointerDown(el, "mouse");
    focusOnPointerDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("已聚焦元素：不拦截（保留原生 caret 点位/拖选）", () => {
    el.focus();
    const focusSpy = vi.spyOn(el, "focus");
    const event = makePointerDown(el, "touch");
    focusOnPointerDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
