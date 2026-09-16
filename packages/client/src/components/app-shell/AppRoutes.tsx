import { lazy } from "react";
import { type Location, Route, Routes } from "react-router";
import { trackLazyLoad } from "../../lib/recovery/lazyRegistry.ts";
import TimelinePage from "../../pages/TimelinePage.tsx";

// 除首屏时间轴外全部路由懒加载：recharts/@xyflow/markdown 等重依赖只在进入对应页面时才加载。
// 一律经 trackLazyLoad 登记在途：chunk 在 iOS 挂起期间被掐断而永不 settle 时，看门狗能点名是哪个页面（结构闸见 appRoutesLazyTracking.test.ts）。
const DiaryPage = lazy(trackLazyLoad("DiaryPage", () => import("../../pages/DiaryPage.tsx")));
const DiaryReviewPage = lazy(
  trackLazyLoad("DiaryReviewPage", () => import("../../pages/diary/review/DiaryReviewPage.tsx")),
);
const StyleguidePage = lazy(trackLazyLoad("StyleguidePage", () => import("../../pages/dev/StyleguidePage.tsx")));
const EntryPage = lazy(trackLazyLoad("EntryPage", () => import("../../pages/EntryPage.tsx")));
const GoalDetailPage = lazy(trackLazyLoad("GoalDetailPage", () => import("../../pages/goals/GoalDetailPage.tsx")));
const GoalsPage = lazy(trackLazyLoad("GoalsPage", () => import("../../pages/goals/GoalsPage.tsx")));
const QuickNotesPage = lazy(trackLazyLoad("QuickNotesPage", () => import("../../pages/QuickNotesPage.tsx")));
const SearchPage = lazy(trackLazyLoad("SearchPage", () => import("../../pages/SearchPage.tsx")));
const SettingsPage = lazy(trackLazyLoad("SettingsPage", () => import("../../pages/SettingsPage.tsx")));
const StatsPage = lazy(trackLazyLoad("StatsPage", () => import("../../pages/StatsPage.tsx")));
const SettingsAdminInsightsPage = lazy(
  trackLazyLoad("SettingsAdminInsightsPage", () => import("../../pages/settings/SettingsAdminInsightsPage.tsx")),
);
const SettingsCategoriesPage = lazy(
  trackLazyLoad("SettingsCategoriesPage", () => import("../../pages/settings/SettingsCategoriesPage.tsx")),
);
const SettingsCategoryDetailPage = lazy(
  trackLazyLoad("SettingsCategoryDetailPage", () => import("../../pages/settings/SettingsCategoryDetailPage.tsx")),
);
const SettingsDataPage = lazy(
  trackLazyLoad("SettingsDataPage", () => import("../../pages/settings/SettingsDataPage.tsx")),
);
const SettingsDesktopPage = lazy(
  trackLazyLoad("SettingsDesktopPage", () => import("../../pages/settings/SettingsDesktopPage.tsx")),
);
const SettingsDiaryPage = lazy(
  trackLazyLoad("SettingsDiaryPage", () => import("../../pages/settings/SettingsDiaryPage.tsx")),
);
const SettingsInsightsPage = lazy(
  trackLazyLoad("SettingsInsightsPage", () => import("../../pages/settings/SettingsInsightsPage.tsx")),
);
const SettingsMorePage = lazy(
  trackLazyLoad("SettingsMorePage", () => import("../../pages/settings/SettingsMorePage.tsx")),
);
const SettingsNavPage = lazy(
  trackLazyLoad("SettingsNavPage", () =>
    import("../../pages/settings/SettingsNavPage.tsx").then((m) => ({ default: m.SettingsNavPage })),
  ),
);
const SettingsServerPage = lazy(
  trackLazyLoad("SettingsServerPage", () => import("../../pages/settings/SettingsServerPage.tsx")),
);
const SettingsStatsLayoutPage = lazy(
  trackLazyLoad("SettingsStatsLayoutPage", () => import("../../pages/settings/SettingsStatsLayoutPage.tsx")),
);
const SettingsTodoGravityPage = lazy(
  trackLazyLoad("SettingsTodoGravityPage", () => import("../../pages/settings/SettingsTodoGravityPage.tsx")),
);
const SettingsTodoStatsLayoutPage = lazy(
  trackLazyLoad("SettingsTodoStatsLayoutPage", () => import("../../pages/settings/SettingsTodoStatsLayoutPage.tsx")),
);
const SettingsTracksPage = lazy(
  trackLazyLoad("SettingsTracksPage", () =>
    import("../../pages/settings/SettingsTracksPage.tsx").then((m) => ({ default: m.SettingsTracksPage })),
  ),
);
const TimeStatsPage = lazy(trackLazyLoad("TimeStatsPage", () => import("../../pages/TimeStatsPage.tsx")));
const TodoPage = lazy(
  trackLazyLoad("TodoPage", () => import("../../pages/TodoPage.tsx").then((m) => ({ default: m.TodoPage }))),
);
const TodoStatsPage = lazy(trackLazyLoad("TodoStatsPage", () => import("../../pages/TodoStatsPage.tsx")));
const TrackDetailPage = lazy(trackLazyLoad("TrackDetailPage", () => import("../../pages/tracks/TrackDetailPage.tsx")));
const TracksListPage = lazy(trackLazyLoad("TracksListPage", () => import("../../pages/tracks/TracksListPage.tsx")));
const TracksShell = lazy(trackLazyLoad("TracksShell", () => import("../../pages/tracks/TracksShell.tsx")));

/**
 * 可选 `location`：不传时 `<Routes>` 读当前 location（改前行为，一字不差）；
 * 传入时该棵路由树按给定 location 匹配——iOS 保留栈（KeptRouteStack）靠它让隐藏的上一层
 * 继续渲染自己那条历史对应的页面。
 */
export function AppRoutes({ location }: { location?: Location } = {}) {
  return (
    <Routes location={location}>
      <Route path="/" element={<TimelinePage />} />
      <Route path="/quick-notes" element={<QuickNotesPage />} />
      <Route path="/diary" element={<DiaryPage />} />
      <Route path="/diary/review" element={<DiaryReviewPage />} />
      <Route path="/todo" element={<TodoPage />} />
      <Route element={<TracksShell />}>
        <Route path="/tracks" element={<TracksListPage />} />
        <Route path="/tracks/:id" element={<TrackDetailPage />} />
      </Route>
      <Route path="/goals" element={<GoalsPage />} />
      <Route path="/goals/:id" element={<GoalDetailPage />} />
      <Route path="/entries/new" element={<EntryPage />} />
      <Route path="/entries/:id/edit" element={<EntryPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/stats/time" element={<TimeStatsPage />} />
      <Route path="/stats/todo" element={<TodoStatsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/categories" element={<SettingsCategoriesPage />} />
      <Route path="/settings/categories/:id" element={<SettingsCategoryDetailPage />} />
      <Route path="/settings/server" element={<SettingsServerPage />} />
      <Route path="/settings/more" element={<SettingsMorePage />} />
      <Route path="/settings/nav" element={<SettingsNavPage />} />
      <Route path="/settings/tracks" element={<SettingsTracksPage />} />
      <Route path="/settings/insights" element={<SettingsInsightsPage />} />
      <Route path="/settings/stats-layout" element={<SettingsStatsLayoutPage />} />
      <Route path="/settings/data" element={<SettingsDataPage />} />
      <Route path="/settings/admin-insights" element={<SettingsAdminInsightsPage />} />
      <Route path="/settings/diary" element={<SettingsDiaryPage />} />
      <Route path="/settings/todo-gravity" element={<SettingsTodoGravityPage />} />
      <Route path="/settings/todo-stats-layout" element={<SettingsTodoStatsLayoutPage />} />
      <Route path="/settings/desktop" element={<SettingsDesktopPage />} />
      <Route path="/dev/styleguide" element={<StyleguidePage />} />
    </Routes>
  );
}
