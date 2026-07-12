import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import TimelinePage from "../../pages/TimelinePage.tsx";

// 除首屏时间轴外全部路由懒加载：recharts/@xyflow/markdown 等重依赖只在进入对应页面时才加载。
const DiaryPage = lazy(() => import("../../pages/DiaryPage.tsx"));
const StyleguidePage = lazy(() => import("../../pages/dev/StyleguidePage.tsx"));
const EntryPage = lazy(() => import("../../pages/EntryPage.tsx"));
const GoalDetailPage = lazy(() => import("../../pages/goals/GoalDetailPage.tsx"));
const GoalsPage = lazy(() => import("../../pages/goals/GoalsPage.tsx"));
const HealthStatsPage = lazy(() => import("../../pages/HealthStatsPage.tsx"));
const QuickNotesPage = lazy(() => import("../../pages/QuickNotesPage.tsx"));
const SettingsPage = lazy(() => import("../../pages/SettingsPage.tsx"));
const StatsPage = lazy(() => import("../../pages/StatsPage.tsx"));
const SettingsAdminInsightsPage = lazy(() => import("../../pages/settings/SettingsAdminInsightsPage.tsx"));
const SettingsCategoriesPage = lazy(() => import("../../pages/settings/SettingsCategoriesPage.tsx"));
const SettingsCategoryDetailPage = lazy(() => import("../../pages/settings/SettingsCategoryDetailPage.tsx"));
const SettingsDataPage = lazy(() => import("../../pages/settings/SettingsDataPage.tsx"));
const SettingsDiaryPage = lazy(() => import("../../pages/settings/SettingsDiaryPage.tsx"));
const SettingsGarminPage = lazy(() => import("../../pages/settings/SettingsGarminPage.tsx"));
const SettingsHealthRangePage = lazy(() => import("../../pages/settings/SettingsHealthRangePage.tsx"));
const SettingsInsightsPage = lazy(() => import("../../pages/settings/SettingsInsightsPage.tsx"));
const SettingsMorePage = lazy(() => import("../../pages/settings/SettingsMorePage.tsx"));
const SettingsNavPage = lazy(() =>
  import("../../pages/settings/SettingsNavPage.tsx").then((m) => ({ default: m.SettingsNavPage })),
);
const SettingsServerPage = lazy(() => import("../../pages/settings/SettingsServerPage.tsx"));
const SettingsStatsLayoutPage = lazy(() => import("../../pages/settings/SettingsStatsLayoutPage.tsx"));
const SettingsTodoGravityPage = lazy(() => import("../../pages/settings/SettingsTodoGravityPage.tsx"));
const SettingsTracksPage = lazy(() =>
  import("../../pages/settings/SettingsTracksPage.tsx").then((m) => ({ default: m.SettingsTracksPage })),
);
const TimeStatsPage = lazy(() => import("../../pages/TimeStatsPage.tsx"));
const TodoPage = lazy(() => import("../../pages/TodoPage.tsx").then((m) => ({ default: m.TodoPage })));
const TrackDetailPage = lazy(() => import("../../pages/tracks/TrackDetailPage.tsx"));
const TracksListPage = lazy(() => import("../../pages/tracks/TracksListPage.tsx"));
const TracksShell = lazy(() => import("../../pages/tracks/TracksShell.tsx"));

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TimelinePage />} />
      <Route path="/quick-notes" element={<QuickNotesPage />} />
      <Route path="/diary" element={<DiaryPage />} />
      <Route path="/todo" element={<TodoPage />} />
      <Route element={<TracksShell />}>
        <Route path="/tracks" element={<TracksListPage />} />
        <Route path="/tracks/:id" element={<TrackDetailPage />} />
      </Route>
      <Route path="/goals" element={<GoalsPage />} />
      <Route path="/goals/:id" element={<GoalDetailPage />} />
      <Route path="/entries/new" element={<EntryPage />} />
      <Route path="/entries/:id/edit" element={<EntryPage />} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/stats/time" element={<TimeStatsPage />} />
      <Route path="/stats/health" element={<HealthStatsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/categories" element={<SettingsCategoriesPage />} />
      <Route path="/settings/categories/:id" element={<SettingsCategoryDetailPage />} />
      <Route path="/settings/server" element={<SettingsServerPage />} />
      <Route path="/settings/more" element={<SettingsMorePage />} />
      <Route path="/settings/nav" element={<SettingsNavPage />} />
      <Route path="/settings/tracks" element={<SettingsTracksPage />} />
      <Route path="/settings/insights" element={<SettingsInsightsPage />} />
      <Route path="/settings/health-range" element={<SettingsHealthRangePage />} />
      <Route path="/settings/stats-layout" element={<SettingsStatsLayoutPage />} />
      <Route path="/settings/data" element={<SettingsDataPage />} />
      <Route path="/settings/admin-insights" element={<SettingsAdminInsightsPage />} />
      <Route path="/settings/garmin" element={<SettingsGarminPage />} />
      <Route path="/settings/diary" element={<SettingsDiaryPage />} />
      <Route path="/settings/todo-gravity" element={<SettingsTodoGravityPage />} />
      <Route path="/dev/styleguide" element={<StyleguidePage />} />
    </Routes>
  );
}
