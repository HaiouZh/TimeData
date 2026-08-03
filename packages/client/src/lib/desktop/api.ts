// 桌面壳 IPC 封装。@tauri-apps/api 只准动态 import：
// 三端（Web/Android/iOS）bundle 会为它出独立 chunk，但 isDesktopShell() gate 内才会执行到
// import()，非桌面端永不加载（跨端回归见 spec §九）。
import { isDesktopShell } from "./shell.js";

export interface DesktopHotkeyBinding {
  shortcut: string;
  action: "punch" | "toggleMain";
}

export interface DesktopConfigDto {
  autostartDisabled: boolean;
  punchConfirmHours: number;
  hotkeys: DesktopHotkeyBinding[];
}

export interface RegistrationOutcome {
  shortcut: string;
  action: string;
  ok: boolean;
  error: string | null;
}

export interface AutostartState {
  enabled: boolean;
  userDisabled: boolean;
}

export interface DesktopHotkeyEvent {
  action: string;
  pressedAtMs: number;
}

/**
 * IPC 失败的可读原因。**Tauri 的 invoke 失败 reject 的是字符串**（Rust 侧 `Err(String)`），
 * 不是 `Error`——只认 `err instanceof Error` 的写法会把 Rust 精心写的那句
 * （「自启已开启，但关闭意图记录失败：…」、带路径的「替换配置文件 X 失败」、
 * 「读取配置文件 X 失败：…」）整句换成一个无信息的兜底词。
 *
 * 桥与设置页此前各写各的：设置页处理了字符串，桥没有。提到这里共用，两边同一套行为。
 */
export function messageOf(err: unknown, fallback = "操作失败"): string {
  if (err instanceof Error && err.message !== "") return err.message;
  if (typeof err === "string" && err !== "") return err;
  return fallback;
}

// 非桌面环境的守卫：@tauri-apps/api 是真包，import 不会失败，只会在包内部抛
// "Cannot read properties of undefined (reading 'invoke')" 这种不可读错误。先自报家门。
export async function invokeDesktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktopShell()) throw new Error("invokeDesktop 只能在桌面壳里调用");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function listenDesktopHotkey(handler: (event: DesktopHotkeyEvent) => void): Promise<() => void> {
  if (!isDesktopShell()) throw new Error("listenDesktopHotkey 只能在桌面壳里调用");
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DesktopHotkeyEvent>("desktop-hotkey", (e) => handler(e.payload));
}
