// @vitest-environment jsdom
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn((): string => "web"));
const addListenerMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ remove: () => {} })));

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

import { KeyboardDebugOverlay } from "./KeyboardDebugOverlay.js";

function query(host: HTMLElement): Element | null {
  return host.querySelector('[data-testid="kbd-debug-overlay"]');
}

describe("KeyboardDebugOverlay", () => {
  beforeEach(() => {
    getPlatformMock.mockReturnValue("web");
    localStorage.clear();
  });

  it("web 平台默认不渲染（桌面浏览器零痕迹）", async () => {
    const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
    expect(query(host)).toBeNull();
    await unmount(root);
  });

  it("web 平台 td.kbdDebug=1 时渲染读数", async () => {
    localStorage.setItem("td.kbdDebug", "1");
    const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
    const overlay = query(host);
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("ih:");
    await unmount(root);
  });

  it("native 平台同样默认不渲染（常显读数条属页面污染，采数据时置 td.kbdDebug=1）", async () => {
    getPlatformMock.mockReturnValue("android");
    const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
    expect(query(host)).toBeNull();
    await unmount(root);
  });
});
