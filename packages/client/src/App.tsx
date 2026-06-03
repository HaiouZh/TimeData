import { useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import AndroidBackButtonHandler from "./components/AndroidBackButtonHandler.tsx";
import AppUpdatePrompt from "./components/AppUpdatePrompt.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { SyncProvider } from "./contexts/SyncContext.tsx";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh.ts";
import EntryPage from "./pages/EntryPage.tsx";
import QuickNotesPage from "./pages/QuickNotesPage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import StatsPage from "./pages/StatsPage.tsx";
import BackupHistoryPage from "./pages/settings/BackupHistoryPage.tsx";
import SettingsAdminInsightsPage from "./pages/settings/SettingsAdminInsightsPage.tsx";
import SettingsCategoriesPage from "./pages/settings/SettingsCategoriesPage.tsx";
import SettingsCategoryDetailPage from "./pages/settings/SettingsCategoryDetailPage.tsx";
import SettingsDataPage from "./pages/settings/SettingsDataPage.tsx";
import SettingsInsightsPage from "./pages/settings/SettingsInsightsPage.tsx";
import SettingsServerPage from "./pages/settings/SettingsServerPage.tsx";
import SettingsStatsLayoutPage from "./pages/settings/SettingsStatsLayoutPage.tsx";
import TimelinePage from "./pages/TimelinePage.tsx";

export function AppShell() {
  const location = useLocation();
  const [resumeRefreshKey, setResumeRefreshKey] = useState(0);
  const hidesBottomNav = location.pathname.startsWith("/entries/") || location.pathname.startsWith("/settings/");

  useAppResumeRefresh(() => setResumeRefreshKey((value) => value + 1));

  return (
    <div className="flex flex-col h-dvh bg-slate-950 text-slate-100">
      <AndroidBackButtonHandler />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<TimelinePage refreshKey={resumeRefreshKey} />} />
          <Route path="/quick-notes" element={<QuickNotesPage />} />
          <Route path="/entries/new" element={<EntryPage refreshKey={resumeRefreshKey} />} />
          <Route path="/entries/:id/edit" element={<EntryPage refreshKey={resumeRefreshKey} />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/categories" element={<SettingsCategoriesPage />} />
          <Route path="/settings/categories/:id" element={<SettingsCategoryDetailPage />} />
          <Route path="/settings/server" element={<SettingsServerPage />} />
          <Route path="/settings/insights" element={<SettingsInsightsPage />} />
          <Route path="/settings/stats-layout" element={<SettingsStatsLayoutPage />} />
          <Route path="/settings/data" element={<SettingsDataPage />} />
          <Route path="/settings/data/backup-history" element={<BackupHistoryPage />} />
          <Route path="/settings/admin-insights" element={<SettingsAdminInsightsPage />} />
        </Routes>
      </main>
      {!hidesBottomNav && (
        <nav className="flex border-t border-slate-800 bg-slate-900">
          {[
            { to: "/quick-notes", label: "记录" },
            { to: "/", label: "时间轴" },
            { to: "/stats", label: "统计" },
            { to: "/settings", label: "设置" },
          ].map((item) => (
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
          <AppShell />
        </SyncProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
