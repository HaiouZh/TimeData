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
