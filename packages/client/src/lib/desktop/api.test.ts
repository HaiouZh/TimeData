import { describe, expect, it } from "vitest";
import { desktopUpdateSubtitleOf, invokeDesktop, listenDesktopHotkey, messageOf } from "./api.js";

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

describe("desktopUpdateSubtitleOf", () => {
  it("已就绪时报新版本号", () => {
    expect(
      desktopUpdateSubtitleOf({
        phase: "ready",
        currentVersion: "26.814.2",
        availableVersion: "26.815.1",
        lastCheckedMs: 1,
        lastError: null,
      }),
    ).toBe("新版 26.815.1 已下载好，点这里更新并重启");
  });

  it("空闲时报当前版本", () => {
    expect(
      desktopUpdateSubtitleOf({
        phase: "idle",
        currentVersion: "26.814.2",
        availableVersion: null,
        lastCheckedMs: 1,
        lastError: null,
      }),
    ).toBe("当前版本：26.814.2");
  });

  it("忙碌时报进行中", () => {
    expect(
      desktopUpdateSubtitleOf({
        phase: "busy",
        currentVersion: "26.814.2",
        availableVersion: null,
        lastCheckedMs: 1,
        lastError: null,
      }),
    ).toBe("正在检查更新…");
  });

  // 失败必须看得见但不喧宾夺主：仍显示当前版本，后面缀失败原因。
  // 只显示「上次检查失败」会把 Rust 侧有区分度的原因（网络 / 验签 / 安装失败）丢掉，
  // 而三者处置完全不同。
  it("上次失败时当前版本与失败原因并列", () => {
    expect(
      desktopUpdateSubtitleOf({
        phase: "idle",
        currentVersion: "26.814.2",
        availableVersion: null,
        lastCheckedMs: 1,
        lastError: "检查更新失败：network error",
      }),
    ).toBe("当前版本：26.814.2 · 检查更新失败：network error");
  });

  it("失败原因短文本时原样拼在副标题后", () => {
    expect(
      desktopUpdateSubtitleOf({
        phase: "idle",
        currentVersion: "26.814.2",
        availableVersion: null,
        lastCheckedMs: 1,
        lastError: "安装更新失败：拒绝访问",
      }),
    ).toBe("当前版本：26.814.2 · 安装更新失败：拒绝访问");
  });

  it("失败原因超过60字符时截断并以省略号结尾", () => {
    expect(
      desktopUpdateSubtitleOf({
        phase: "idle",
        currentVersion: "26.814.2",
        availableVersion: null,
        lastCheckedMs: 1,
        lastError: "e".repeat(80),
      }),
    ).toBe(`当前版本：26.814.2 · ${"e".repeat(60)}…`);
  });

  it("开发构建明说不检查", () => {
    expect(
      desktopUpdateSubtitleOf({
        phase: "disabled",
        currentVersion: "0.1.0",
        availableVersion: null,
        lastCheckedMs: null,
        lastError: null,
      }),
    ).toBe("开发构建不检查更新");
  });
});
