import { Route, Routes } from "react-router-dom";
import DiaryPage from "../../pages/DiaryPage.tsx";
import StyleguidePage from "../../pages/dev/StyleguidePage.tsx";
import EntryPage from "../../pages/EntryPage.tsx";
import GoalDetailPage from "../../pages/goals/GoalDetailPage.tsx";
import GoalsPage from "../../pages/goals/GoalsPage.tsx";
import HealthStatsPage from "../../pages/HealthStatsPage.tsx";
import QuickNotesPage from "../../pages/QuickNotesPage.tsx";
import SettingsPage from "../../pages/SettingsPage.tsx";
import StatsPage from "../../pages/StatsPage.tsx";
import SettingsAdminInsightsPage from "../../pages/settings/SettingsAdminInsightsPage.tsx";
import SettingsCategoriesPage from "../../pages/settings/SettingsCategoriesPage.tsx";
import SettingsCategoryDetailPage from "../../pages/settings/SettingsCategoryDetailPage.tsx";
import SettingsDataPage from "../../pages/settings/SettingsDataPage.tsx";
import SettingsDiaryPage from "../../pages/settings/SettingsDiaryPage.tsx";
import SettingsGarminPage from "../../pages/settings/SettingsGarminPage.tsx";
import SettingsHealthRangePage from "../../pages/settings/SettingsHealthRangePage.tsx";
import SettingsInsightsPage from "../../pages/settings/SettingsInsightsPage.tsx";
import SettingsMorePage from "../../pages/settings/SettingsMorePage.tsx";
import { SettingsNavPage } from "../../pages/settings/SettingsNavPage.tsx";
import SettingsServerPage from "../../pages/settings/SettingsServerPage.tsx";
import SettingsStatsLayoutPage from "../../pages/settings/SettingsStatsLayoutPage.tsx";
import SettingsTodoGravityPage from "../../pages/settings/SettingsTodoGravityPage.tsx";
import { SettingsTracksPage } from "../../pages/settings/SettingsTracksPage.tsx";
import TimelinePage from "../../pages/TimelinePage.tsx";
import TimeStatsPage from "../../pages/TimeStatsPage.tsx";
import { TodoPage } from "../../pages/TodoPage.tsx";
import TrackDetailPage from "../../pages/tracks/TrackDetailPage.tsx";
import TracksListPage from "../../pages/tracks/TracksListPage.tsx";
import TracksShell from "../../pages/tracks/TracksShell.tsx";

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
