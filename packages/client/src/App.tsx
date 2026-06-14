import { useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import AndroidBackButtonHandler from "./components/AndroidBackButtonHandler.tsx";
import AppUpdatePrompt from "./components/AppUpdatePrompt.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { BOTTOM_NAV_HEIGHT_PX, BottomNavProvider, useBottomNav } from "./contexts/BottomNavContext.tsx";
import { SyncProvider } from "./contexts/SyncContext.tsx";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh.ts";
import { useHideBottomNavOnScroll } from "./hooks/useHideBottomNavOnScroll.ts";
import { useVisibleTabs } from "./lib/settings/navVisibleTabsSetting.ts";
import EntryPage from "./pages/EntryPage.tsx";
import QuickNotesPage from "./pages/QuickNotesPage.tsx";
import HealthStatsPage from "./pages/HealthStatsPage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import StatsPage from "./pages/StatsPage.tsx";
import TimeStatsPage from "./pages/TimeStatsPage.tsx";
import { TodoPage } from "./pages/TodoPage.tsx";
import BackupHistoryPage from "./pages/settings/BackupHistoryPage.tsx";
import SettingsAdminInsightsPage from "./pages/settings/SettingsAdminInsightsPage.tsx";
import SettingsCategoriesPage from "./pages/settings/SettingsCategoriesPage.tsx";
import SettingsCategoryDetailPage from "./pages/settings/SettingsCategoryDetailPage.tsx";
import SettingsDataPage from "./pages/settings/SettingsDataPage.tsx";
import SettingsInsightsPage from "./pages/settings/SettingsInsightsPage.tsx";
import { SettingsNavPage } from "./pages/settings/SettingsNavPage.tsx";
import SettingsServerPage from "./pages/settings/SettingsServerPage.tsx";
import SettingsStatsLayoutPage from "./pages/settings/SettingsStatsLayoutPage.tsx";
import SettingsGarminPage from "./pages/settings/SettingsGarminPage.tsx";
import TimelinePage from "./pages/TimelinePage.tsx";

const TAB_LABELS: Record<string, string> = {
  "/quick-notes": "记录",
  "/": "时间轴",
  "/todo": "待办",
  "/stats/time": "时间",
  "/stats/health": "健康",
  "/settings": "设置",
};

export function AppShell() {
  const location = useLocation();
  const [resumeRefreshKey, setResumeRefreshKey] = useState(0);
  const { hidden } = useBottomNav();
  const visibleTabs = useVisibleTabs();
  const onMainScroll = useHideBottomNavOnScroll();
  const hidesBottomNav = location.pathname.startsWith("/entries/") || location.pathname.startsWith("/settings/");
  const navItems = [...visibleTabs, "/settings"].map((to) => ({ to, label: TAB_LABELS[to] }));

  useAppResumeRefresh(() => setResumeRefreshKey((value) => value + 1));

  return (
    <div className="flex flex-col h-dvh bg-slate-950 text-slate-100">
      <AndroidBackButtonHandler />
      <main className="min-h-0 flex-1 overflow-y-auto" onScroll={onMainScroll}>
        <Routes>
          <Route path="/" element={<TimelinePage refreshKey={resumeRefreshKey} />} />
          <Route path="/quick-notes" element={<QuickNotesPage />} />
          <Route path="/todo" element={<TodoPage />} />
          <Route path="/entries/new" element={<EntryPage refreshKey={resumeRefreshKey} />} />
          <Route path="/entries/:id/edit" element={<EntryPage refreshKey={resumeRefreshKey} />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/stats/time" element={<TimeStatsPage />} />
          <Route path="/stats/health" element={<HealthStatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/categories" element={<SettingsCategoriesPage />} />
          <Route path="/settings/categories/:id" element={<SettingsCategoryDetailPage />} />
          <Route path="/settings/server" element={<SettingsServerPage />} />
          <Route path="/settings/nav" element={<SettingsNavPage />} />
          <Route path="/settings/insights" element={<SettingsInsightsPage />} />
          <Route path="/settings/stats-layout" element={<SettingsStatsLayoutPage />} />
          <Route path="/settings/data" element={<SettingsDataPage />} />
          <Route path="/settings/data/backup-history" element={<BackupHistoryPage />} />
          <Route path="/settings/admin-insights" element={<SettingsAdminInsightsPage />} />
          <Route path="/settings/garmin" element={<SettingsGarminPage />} />
        </Routes>
      </main>
      {!hidesBottomNav && (
        <nav
          className={`flex shrink-0 overflow-hidden bg-slate-900 transition-[height] duration-200 ${
            hidden ? "" : "border-t border-slate-800"
          }`}
          style={{ height: hidden ? 0 : BOTTOM_NAV_HEIGHT_PX }}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex-1 py-3 text-center text-sm ${isActive ? "text-blue-400" : "text-slate-500"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
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
