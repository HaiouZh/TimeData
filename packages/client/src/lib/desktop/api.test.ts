import { describe, expect, it } from "vitest";
import { invokeDesktop, listenDesktopHotkey, messageOf } from "./api.js";

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

describe("messageOf", () => {
  // Tauri 的 invoke 失败 reject 的是**字符串**（Rust 的 Err(String)）。只认 Error 的写法
  // 会把 Rust 精心写的那句换成一个无信息的兜底词——这条是那半边的闸。
  it("字符串（Tauri 的真实形状）原样读出来", () => {
    expect(messageOf("自启已开启，但关闭意图记录失败：拒绝访问")).toBe("自启已开启，但关闭意图记录失败：拒绝访问");
  });

  it("Error 读 message", () => {
    expect(messageOf(new Error("替换配置文件 C:/x.json 失败"))).toBe("替换配置文件 C:/x.json 失败");
  });

  it("读不出原因时才用兜底词，且兜底词可由调用方指定", () => {
    expect(messageOf(undefined)).toBe("操作失败");
    expect(messageOf({ code: 500 })).toBe("操作失败");
    expect(messageOf("")).toBe("操作失败");
    expect(messageOf(new Error(""))).toBe("操作失败");
    expect(messageOf(null, "打点失败")).toBe("打点失败");
  });
});
