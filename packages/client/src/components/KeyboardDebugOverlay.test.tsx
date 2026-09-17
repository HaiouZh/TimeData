// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { readStoredMotion } from "../lib/keyboard/keyboardMotionPrefs.js";
import { KeyboardDebugOverlay } from "./KeyboardDebugOverlay.js";

function query(host: HTMLElement): Element | null {
  return host.querySelector('[data-testid="kbd-debug-overlay"]');
}

function enableBoth() {
  localStorage.setItem("timedata_keyboard_probe", JSON.stringify({ on: true, left: 20 }));
  localStorage.setItem("timedata_keyboard_debug", "1");
}

async function clickButton(host: HTMLElement, label: string) {
  const btn = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  expect(btn, label).toBeTruthy();
  await act(async () => {
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("KeyboardDebugOverlay", () => {
  beforeEach(() => {
    getPlatformMock.mockReturnValue("web");
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("默认不渲染（web / native 都零痕迹）", async () => {
    for (const platform of ["web", "android"]) {
      getPlatformMock.mockReturnValue(platform);
      const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
      expect(query(host)).toBeNull();
      await unmount(root);
    }
  });

  it("只开探针不开浮层、或只开浮层不开探针：都不渲染（浮层是探针的附属显示）", async () => {
    localStorage.setItem("timedata_keyboard_probe", JSON.stringify({ on: true, left: 20 }));
    const a = await renderDom(createElement(KeyboardDebugOverlay));
    expect(query(a.host)).toBeNull();
    await unmount(a.root);

    localStorage.clear();
    localStorage.setItem("timedata_keyboard_debug", "1");
    const b = await renderDom(createElement(KeyboardDebugOverlay));
    expect(query(b.host)).toBeNull();
    await unmount(b.root);
  });

  it("旧 key td.kbdDebug 已退役，不再开浮层", async () => {
    localStorage.setItem("td.kbdDebug", "1");
    const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
    expect(query(host)).toBeNull();
    await unmount(root);
  });

  it("两个开关都开：渲染读数、当前时长曲线；设置页广播后即时显隐", async () => {
    const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
    expect(query(host)).toBeNull();
    await act(async () => {
      enableBoth();
      window.dispatchEvent(new Event("td:keyboard-probe"));
    });
    const overlay = query(host);
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("ih:");
    expect(overlay?.textContent).toContain("mo:250/200 tg");
    await unmount(root);
  });

  it("调参按钮：show +20 / hide −20 写 override 并即时反映；曲线循环；重置回默认", async () => {
    enableBoth();
    getPlatformMock.mockReturnValue("android");
    const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
    expect(query(host)?.textContent).toContain("mo:285/285 android");

    await clickButton(host, "show+");
    expect(readStoredMotion().overrideShowMs).toBe(305);
    expect(query(host)?.textContent).toContain("mo:305/285 android");

    await clickButton(host, "hide−");
    expect(readStoredMotion().overrideHideMs).toBe(265);
    expect(query(host)?.textContent).toContain("mo:305/265 android");

    await clickButton(host, "曲线");
    expect(readStoredMotion().overrideEasing).toBe("tg");
    expect(query(host)?.textContent).toContain("mo:305/265 tg");

    await clickButton(host, "重置");
    expect(readStoredMotion()).toEqual({});
    expect(query(host)?.textContent).toContain("mo:285/285 android");
    await unmount(root);
  });

  it("调参不越过采信窗：show 到 700 后再加不动，hide 到 80 后再减不动", async () => {
    enableBoth();
    localStorage.setItem("timedata_keyboard_motion", JSON.stringify({ overrideShowMs: 700, overrideHideMs: 80 }));
    const { host, root } = await renderDom(createElement(KeyboardDebugOverlay));
    await clickButton(host, "show+");
    await clickButton(host, "hide−");
    expect(readStoredMotion().overrideShowMs).toBe(700);
    expect(readStoredMotion().overrideHideMs).toBe(80);
    await unmount(root);
  });
});
