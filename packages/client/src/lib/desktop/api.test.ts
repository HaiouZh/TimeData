import { describe, expect, it } from "vitest";
import { invokeDesktop, listenDesktopHotkey } from "./api.js";

// node 环境无 window → isDesktopShell() 为 false，守卫在动态 import 之前就抛，
// 故本文件不会真去加载 @tauri-apps/api（无需 mock）。
describe("非桌面环境的 IPC 守卫", () => {
  it("invokeDesktop 直接 reject 且自报函数名", async () => {
    await expect(invokeDesktop("get_desktop_config")).rejects.toThrow("invokeDesktop");
  });

  it("listenDesktopHotkey 直接 reject 且自报函数名", async () => {
    await expect(listenDesktopHotkey(() => {})).rejects.toThrow("listenDesktopHotkey");
  });
});
