// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isDesktopShell } from "./shell.js";

afterEach(() => {
  delete (window as Record<string, unknown>)["__TAURI_INTERNALS__"];
});

describe("isDesktopShell", () => {
  it("无 Tauri 注入时为 false（Web / Capacitor 壳）", () => {
    expect(isDesktopShell()).toBe(false);
  });

  it("有 __TAURI_INTERNALS__ 注入时为 true", () => {
    (window as Record<string, unknown>)["__TAURI_INTERNALS__"] = {};
    expect(isDesktopShell()).toBe(true);
  });
});
