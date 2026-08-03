// 桌面壳 IPC 封装。@tauri-apps/api 只准动态 import：
// 三端（Web/Android/iOS）bundle 会为它出独立 chunk，但 isDesktopShell() gate 内才会执行到
// import()，非桌面端永不加载（跨端回归见 spec §九）。
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

export async function invokeDesktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function listenDesktopHotkey(handler: (event: DesktopHotkeyEvent) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DesktopHotkeyEvent>("desktop-hotkey", (e) => handler(e.payload));
}
