import { afterEach, describe, expect, it } from "vitest";
import { isCaptureWindow, isDesktopShell } from "./shell.js";

// node 桶写法：不挂 jsdom 环境注释指令、不用 defineProperty（两者都是脏标记，会被挡在
// unit-clean 快桶外）。直接在 globalThis 上装/卸一个最小 window 即可，
// 顺带把「window 未定义」这一档也测上——jsdom 里 window 恒在，那个守卫在 jsdom 下无闸。
function setWindow(value: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).window = value;
}

afterEach(() => {
  // biome-ignore lint/performance/noDelete: 测的就是「没有 window 这个全局」的环境；赋 undefined 后 `"window" in globalThis` 仍为 true，桌面壳探测会走另一条分支
  delete (globalThis as Record<string, unknown>).window;
});

describe("isDesktopShell", () => {
  it("window 未定义时为 false（node / SSR 求值，不许抛）", () => {
    expect(isDesktopShell()).toBe(false);
  });

  it("无 Tauri 注入时为 false（Web / Capacitor 壳）", () => {
    setWindow({});
    expect(isDesktopShell()).toBe(false);
  });

  it("有 __TAURI_INTERNALS__ 注入时为 true", () => {
    setWindow({ __TAURI_INTERNALS__: {} });
    expect(isDesktopShell()).toBe(true);
  });
});

describe("isCaptureWindow", () => {
  it("桌面壳 + ?window=capture 才是浮窗", () => {
    setWindow({ __TAURI_INTERNALS__: {}, location: { search: "?window=capture" } });
    expect(isCaptureWindow()).toBe(true);
  });

  it("桌面壳里没带 query 的是主窗口", () => {
    setWindow({ __TAURI_INTERNALS__: {}, location: { search: "" } });
    expect(isCaptureWindow()).toBe(false);
  });

  it("非桌面壳里手敲 ?window=capture 不算——Web/Android/iOS 三端必须够不着浮窗", () => {
    setWindow({ location: { search: "?window=capture" } });
    expect(isCaptureWindow()).toBe(false);
  });

  it("query 值不对不算", () => {
    setWindow({ __TAURI_INTERNALS__: {}, location: { search: "?window=main" } });
    expect(isCaptureWindow()).toBe(false);
  });

  // 短路顺序的闸：window 未定义时必须先被 isDesktopShell 挡住，绝不能走到读 window.location
  // 那一步——走到了就是 ReferenceError，而不是安安静静返回 false。
  it("window 未定义时为 false 且不抛", () => {
    expect(() => isCaptureWindow()).not.toThrow();
    expect(isCaptureWindow()).toBe(false);
  });
});
