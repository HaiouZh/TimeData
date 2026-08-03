// 桌面壳判定：Tauri v2 往每个 WebView 注入 __TAURI_INTERNALS__。
// 与 Capacitor.isNativePlatform()（Android/iOS 壳）互斥，四端只会命中一种。
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
