import { afterEach, describe, expect, it } from "vitest";
import { isDesktopShell } from "./shell.js";

// node 桶写法：不挂 jsdom 环境注释指令、不用 defineProperty（两者都是脏标记，会被挡在
// unit-clean 快桶外）。直接在 globalThis 上装/卸一个最小 window 即可，
// 顺带把「window 未定义」这一档也测上——jsdom 里 window 恒在，那个守卫在 jsdom 下无闸。
function setWindow(value: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).window = value;
}

afterEach(() => {
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
