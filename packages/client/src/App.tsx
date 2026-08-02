import { Suspense } from "react";
import { createBrowserRouter, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import AndroidBackButtonHandler from "./components/AndroidBackButtonHandler.tsx";
import AppUpdatePrompt from "./components/AppUpdatePrompt.tsx";
import { AppRoutes } from "./components/app-shell/AppRoutes.tsx";
import { DesktopSidebar } from "./components/app-shell/DesktopSidebar.tsx";
import { MobileBottomNav } from "./components/app-shell/MobileBottomNav.tsx";
import { ErrorBoundary, RouteErrorFallback } from "./components/ErrorBoundary.tsx";
import { TotpPromptDialog } from "./components/TotpPromptDialog.tsx";
import { BottomNavProvider } from "./contexts/BottomNavContext.tsx";
import { SyncProvider } from "./contexts/SyncContext.tsx";
import { TrackAttentionProvider } from "./contexts/TrackAttentionContext.tsx";
import { useDocumentTitle } from "./hooks/useDocumentTitle.ts";
import { useFavicon } from "./hooks/useFavicon.ts";
import { useHideBottomNavOnScroll } from "./hooks/useHideBottomNavOnScroll.ts";
import { useIsWideScreen } from "./lib/useIsWideScreen.ts";

export function AppShell() {
  const location = useLocation();
  const isWideScreen = useIsWideScreen();
  const onMainScroll = useHideBottomNavOnScroll();
  const hidesBottomNav =
    location.pathname.startsWith("/entries/") ||
    location.pathname.startsWith("/settings/") ||
    location.pathname.startsWith("/goals/") ||
    location.pathname.startsWith("/tracks/");

  useDocumentTitle(location.pathname);
  useFavicon(location.pathname);

  return (
    <div className="td-safe-top td-safe-x flex h-dvh bg-page text-ink">
      <AndroidBackButtonHandler />
      {isWideScreen && <DesktopSidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-none" onScroll={isWideScreen ? undefined : onMainScroll}>
          <Suspense fallback={null}>
            <AppRoutes />
          </Suspense>
        </main>
        {!isWideScreen && !hidesBottomNav && <MobileBottomNav />}
      </div>
      <AppUpdatePrompt />
      <TotpPromptDialog />
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
