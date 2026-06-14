import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./App.js";
import { BottomNavProvider } from "./contexts/BottomNavContext.js";

vi.mock("./hooks/useAppResumeRefresh.ts", () => ({
  useAppResumeRefresh: () => {},
}));

vi.mock("./components/AppUpdatePrompt.tsx", () => ({
  default: () => null,
}));

vi.mock("./lib/settings/navVisibleTabsSetting.ts", () => ({
  useVisibleTabs: () => ["/quick-notes", "/", "/todo", "/stats/time", "/stats/health"],
}));

vi.mock("./pages/TimelinePage.tsx", () => ({
  default: ({ refreshKey }: { refreshKey: number }) => createElement("div", null, `时间轴页面 ${refreshKey}`),
}));

vi.mock("./pages/EntryPage.tsx", () => ({
  default: ({ refreshKey }: { refreshKey: number }) => createElement("div", null, `记录页面 ${refreshKey}`),
}));

vi.mock("./pages/QuickNotesPage.tsx", () => ({
  default: () => createElement("div", null, "速记页面"),
}));

vi.mock("./pages/TimeStatsPage.tsx", () => ({
  default: () => createElement("div", null, "时间统计页面"),
}));

vi.mock("./pages/HealthStatsPage.tsx", () => ({
  default: () => createElement("div", null, "健康统计页面"),
}));

vi.mock("./pages/StatsPage.tsx", () => ({
  default: () => createElement("div", null, "旧统计入口"),
}));

vi.mock("./pages/TodoPage.tsx", () => ({
  TodoPage: () => createElement("div", null, "待办页面"),
}));

vi.mock("./pages/settings/SettingsCategoriesPage.tsx", () => ({
  default: () => createElement("div", null, "分类列表页"),
}));

vi.mock("./pages/settings/SettingsCategoryDetailPage.tsx", () => ({
  default: () => createElement("div", null, "分类详情页"),
}));

vi.mock("./pages/SettingsPage.tsx", () => ({
  default: () => createElement("div", null, "设置首页"),
}));

vi.mock("./pages/settings/SettingsServerPage.tsx", () => ({
  default: () => createElement("div", null, "服务器配置页"),
}));

vi.mock("./pages/settings/SettingsDataPage.tsx", () => ({
  default: () => createElement("div", null, "数据设置页"),
}));

vi.mock("./pages/settings/SettingsInsightsPage.tsx", () => ({
  default: () => createElement("div", null, "数据洞察设置页"),
}));

vi.mock("./pages/settings/SettingsNavPage.tsx", () => ({
  SettingsNavPage: () => createElement("div", null, "底部导航设置页"),
}));

function renderAppShell(initialEntry: string) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(BottomNavProvider, null, createElement(AppShell)),
    ),
  );
}

describe("AppShell settings routes", () => {
  it("renders settings data route without bottom navigation", () => {
    const html = renderAppShell("/settings/data");

    expect(html).toContain("数据设置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings server route without bottom navigation", () => {
    const html = renderAppShell("/settings/server");

    expect(html).toContain("服务器配置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings insights route without bottom navigation", () => {
    const html = renderAppShell("/settings/insights");

    expect(html).toContain("数据洞察设置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings nav route without bottom navigation", () => {
    const html = renderAppShell("/settings/nav");

    expect(html).toContain("底部导航设置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders category settings routes without bottom navigation", () => {
    const listHtml = renderAppShell("/settings/categories");
    const detailHtml = renderAppShell("/settings/categories/category-1");

    expect(listHtml).toContain("分类列表页");
    expect(detailHtml).toContain("分类详情页");
    expect(listHtml).not.toContain("时间轴");
    expect(detailHtml).not.toContain("统计");
  });

  it("passes the resume refresh key to time-sensitive pages", () => {
    const timelineHtml = renderAppShell("/");
    const entryHtml = renderAppShell("/entries/new");

    expect(timelineHtml).toContain("时间轴页面 0");
    expect(entryHtml).toContain("记录页面 0");
  });

  it("renders quick notes route and bottom navigation entry", () => {
    const html = renderAppShell("/quick-notes");

    expect(html).toContain("速记页面");
    expect(html).toContain("记录");
    expect(html).toContain("时间轴");
    expect(html).toContain("待办");
    expect(html).toContain("时间");
    expect(html).toContain("健康");
    expect(html).toContain("设置");
  });

  it("renders todo route and bottom navigation entry", () => {
    const html = renderAppShell("/todo");

    expect(html).toContain("待办页面");
    expect(html).toContain("待办");
  });

  it("renders separate time and health stats routes", () => {
    expect(renderAppShell("/stats/time")).toContain("时间统计页面");
    expect(renderAppShell("/stats/health")).toContain("健康统计页面");
  });
});
