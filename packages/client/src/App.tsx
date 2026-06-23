import { useState } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import AndroidBackButtonHandler from "./components/AndroidBackButtonHandler.tsx";
import AppUpdatePrompt from "./components/AppUpdatePrompt.tsx";
import { AppRoutes } from "./components/app-shell/AppRoutes.tsx";
import { DesktopSidebar } from "./components/app-shell/DesktopSidebar.tsx";
import { MobileBottomNav } from "./components/app-shell/MobileBottomNav.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { BottomNavProvider } from "./contexts/BottomNavContext.tsx";
import { SyncProvider } from "./contexts/SyncContext.tsx";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh.ts";
import { useHideBottomNavOnScroll } from "./hooks/useHideBottomNavOnScroll.ts";
import { useIsWideScreen } from "./lib/useIsWideScreen.ts";

export function AppShell() {
  const location = useLocation();
  const [resumeRefreshKey, setResumeRefreshKey] = useState(0);
  const isWideScreen = useIsWideScreen();
  const onMainScroll = useHideBottomNavOnScroll();
  const hidesBottomNav =
    location.pathname.startsWith("/entries/") ||
    location.pathname.startsWith("/settings/") ||
    location.pathname.startsWith("/goals/") ||
    location.pathname.startsWith("/tracks/");

  useAppResumeRefresh(() => setResumeRefreshKey((value) => value + 1));

  return (
    <div className="flex h-dvh bg-page text-ink">
      <AndroidBackButtonHandler />
      {isWideScreen && <DesktopSidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-none" onScroll={isWideScreen ? undefined : onMainScroll}>
          <AppRoutes refreshKey={resumeRefreshKey} />
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
            <AppShell />
          </BottomNavProvider>
        </SyncProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
