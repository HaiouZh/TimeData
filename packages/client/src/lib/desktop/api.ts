// 桌面壳 IPC 封装。@tauri-apps/api 只准动态 import：
// 三端（Web/Android/iOS）bundle 会为它出独立 chunk，但 isDesktopShell() gate 内才会执行到
// import()，非桌面端永不加载（跨端回归见 spec §九）。
import { isDesktopShell } from "./shell.js";

export interface DesktopHotkeyBinding {
  shortcut: string;
  action: "punch" | "toggleMain" | "capture" | "navigate";
  /** 只有 action 为 "navigate" 时有意义，值是 MAIN_NAV_ITEMS 里的路径。 */
  target?: string;
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
  target?: string;
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

export interface DesktopUpdaterStatus {
  /** "disabled" | "idle" | "busy" | "ready" */
  phase: string;
  currentVersion: string;
  availableVersion: string | null;
  lastCheckedMs: number | null;
  lastError: string | null;
}

export function desktopUpdateSubtitleOf(status: DesktopUpdaterStatus): string {
  if (status.phase === "disabled") return "开发构建不检查更新";
  if (status.phase === "busy") return "正在检查更新…";
  if (status.phase === "ready" && status.availableVersion) {
    return `新版 ${status.availableVersion} 已下载好，点这里更新并重启`;
  }
  const base = `当前版本：${status.currentVersion}`;
  if (!status.lastError) return base;
  // Rust 侧存的是有区分度的原因（网络 / 验签 / 安装失败），三者处置完全不同，
  // 折叠成一句「上次检查失败」等于把这个区分丢掉。副标题是单行，超长要截。
  const detail = status.lastError.length > 60 ? `${status.lastError.slice(0, 60)}…` : status.lastError;
  return `${base} · ${detail}`;
}

export async function fetchDesktopUpdaterStatus(): Promise<DesktopUpdaterStatus> {
  return invokeDesktop<DesktopUpdaterStatus>("updater_status");
}

export async function checkDesktopUpdateNow(): Promise<void> {
  return invokeDesktop<void>("updater_check_now");
}

export async function installDesktopUpdate(): Promise<void> {
  return invokeDesktop<void>("updater_install");
}
