import { Suspense } from "react";
import { createBrowserRouter, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Capacitor } from "@capacitor/core";
import AndroidBackButtonHandler from "./components/AndroidBackButtonHandler.tsx";
import AppUpdatePrompt from "./components/AppUpdatePrompt.tsx";
import { AppRoutes } from "./components/app-shell/AppRoutes.tsx";
import { DesktopSidebar } from "./components/app-shell/DesktopSidebar.tsx";
import { KeptRouteStack } from "./components/app-shell/KeptRouteStack.tsx";
import { MobileBottomNav } from "./components/app-shell/MobileBottomNav.tsx";
import { DesktopBridge } from "./components/desktop/DesktopBridge.tsx";
import EdgeSwipeBack from "./components/EdgeSwipeBack.tsx";
import { ErrorBoundary, RouteErrorFallback } from "./components/ErrorBoundary.tsx";
import { KeyboardAvoidanceBridge } from "./components/KeyboardAvoidanceBridge.tsx";
import { SchedulerWatchdog } from "./components/SchedulerWatchdog.tsx";
import { TotpPromptDialog } from "./components/TotpPromptDialog.tsx";
import { isDesktopShell } from "./lib/desktop/shell.ts";
import { BottomNavProvider } from "./contexts/BottomNavContext.tsx";
import { SyncProvider } from "./contexts/SyncContext.tsx";
import { TrackAttentionProvider } from "./contexts/TrackAttentionContext.tsx";
import { useDocumentTitle } from "./hooks/useDocumentTitle.ts";
import { useFavicon } from "./hooks/useFavicon.ts";
import { useHideBottomNavOnScroll } from "./hooks/useHideBottomNavOnScroll.ts";
import { layoutHidesBottomNav } from "./lib/navigation/navRegistry.ts";
import { useIsWideScreen } from "./lib/useIsWideScreen.ts";

// Android 壳由 MainActivity 在原生层做唯一安全区让位（systemBars+displayCutout 的 inset padding），
// 而 WebView 里的 env(safe-area-inset-*) 会照常报非零值、与原生 padding 叠加成双倍留白，故在首帧前
// 给 <html> 打平台标记，让 CSS 把 --safe-* 清零（见 index.css）。模块顶层执行：早于 React 渲染无闪跳；
// 非 Android（web / iOS）不设标记、行为不变。
if (typeof document !== "undefined" && Capacitor.getPlatform() === "android") {
  document.documentElement.dataset.platform = "android";
}

export function AppShell() {
  const location = useLocation();
  const isWideScreen = useIsWideScreen();
  const onMainScroll = useHideBottomNavOnScroll();
  // 与 KeptRouteStack 共用同一份判据（导出在 navRegistry.ts）：手抄两份会让 iOS 与非 iOS 静默分叉。
  const hidesBottomNav = layoutHidesBottomNav(location.pathname);
  // iOS 才用保留上一页的路由栈（边缘返回要露出活的上一页）。其余平台渲染路径一字不改。
  const useKeptStack = Capacitor.getPlatform() === "ios";

  useDocumentTitle(location.pathname);
  useFavicon(location.pathname);

  return (
    <div className="td-safe-top td-safe-x flex h-dvh bg-page text-ink">
      <AndroidBackButtonHandler />
      {/* 自身按平台 gate（非 iOS 连监听都不挂），故与 AndroidBackButtonHandler 一样无条件渲染。 */}
      <EdgeSwipeBack />
      {/* 键盘遮挡量 → 全局 CSS 变量 + 聚焦跟随滚动，两条渲染路径共用（见组件注释）。 */}
      <KeyboardAvoidanceBridge />
      {/* 回前台时探一枚 transition 探针，卡住即判定调度器死锁并自救；正常路径永不触发。 */}
      <SchedulerWatchdog />
      {isWideScreen && <DesktopSidebar />}
      {useKeptStack ? (
        <KeptRouteStack isWideScreen={isWideScreen} onMainScroll={onMainScroll} />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-none" onScroll={isWideScreen ? undefined : onMainScroll}>
            <Suspense fallback={null}>
              <AppRoutes />
            </Suspense>
          </main>
          {!isWideScreen && !hidesBottomNav && <MobileBottomNav />}
        </div>
      )}
      <AppUpdatePrompt />
      <TotpPromptDialog />
      {isDesktopShell() && <DesktopBridge />}
    </div>
  );
}

// 惰性单例：模块顶层不创建 router——createBrowserRouter 会读写 window.history，
// 在 import 阶段执行会让 node 环境的测试（如 App.test.tsx）在 collect 阶段崩。
// 单例保证「不随渲染重建」，历史状态不丢。
let routerInstance: ReturnType<typeof createBrowserRouter> | null = null;

export function getRouter() {
  routerInstance ??= createBrowserRouter([
    {
      path: "*",
      element: (
        <SyncProvider>
          <BottomNavProvider>
            <TrackAttentionProvider>
              <AppShell />
            </TrackAttentionProvider>
          </BottomNavProvider>
        </SyncProvider>
      ),
      // 根路由（index 0）总被 RR 包一层 boundary；不给 errorElement 会落回 RR 自带的
      // 未翻译兜底页，见 components/ErrorBoundary.tsx 的 RouteErrorFallback 注释。
      errorElement: <RouteErrorFallback />,
    },
  ]);
  return routerInstance;
}

export default function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={getRouter()} />
    </ErrorBoundary>
  );
}
