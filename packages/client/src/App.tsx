import { Suspense } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import AndroidBackButtonHandler from "./components/AndroidBackButtonHandler.tsx";
import AppUpdatePrompt from "./components/AppUpdatePrompt.tsx";
import { AppRoutes } from "./components/app-shell/AppRoutes.tsx";
import { DesktopSidebar } from "./components/app-shell/DesktopSidebar.tsx";
import { MobileBottomNav } from "./components/app-shell/MobileBottomNav.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
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
    <div className="flex h-dvh bg-page text-ink">
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
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <SyncProvider>
          <BottomNavProvider>
            <TrackAttentionProvider>
              <AppShell />
            </TrackAttentionProvider>
          </BottomNavProvider>
        </SyncProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
