// 桌面壳判定：Tauri v2 往每个 WebView 注入 __TAURI_INTERNALS__。
// 与 Capacitor.isNativePlatform()（Android/iOS 壳）互斥，四端只会命中一种。
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 速记浮窗判定。**两个条件都要**：Web / Android / iOS 上有人手敲 `?window=capture`
 * 不该进浮窗模式（浮窗在三端必须够不着）。
 * 判据与 tauri.conf.json 里浮窗的 url 逐字对应，改一侧要改两侧——
 * check-desktop-config.mjs 断言了那个 url 的字面量。
 */
export function isCaptureWindow(): boolean {
  if (!isDesktopShell()) return false;
  return new URLSearchParams(window.location.search).get("window") === "capture";
}
