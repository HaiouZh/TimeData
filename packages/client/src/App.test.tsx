import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./App.js";

vi.mock("./hooks/useAppResumeRefresh.ts", () => ({
  useAppResumeRefresh: () => {},
}));

vi.mock("./components/AppUpdatePrompt.tsx", () => ({
  default: () => null,
}));

vi.mock("./pages/TimelinePage.tsx", () => ({
  default: ({ refreshKey }: { refreshKey: number }) => createElement("div", null, `时间轴页面 ${refreshKey}`),
}));

vi.mock("./pages/EntryPage.tsx", () => ({
  default: ({ refreshKey }: { refreshKey: number }) => createElement("div", null, `记录页面 ${refreshKey}`),
}));

vi.mock("./pages/StatsPage.tsx", () => ({
  default: () => createElement("div", null, "统计页面"),
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

describe("AppShell settings routes", () => {
  it("renders settings data route without bottom navigation", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/settings/data"] }, createElement(AppShell))
    );

    expect(html).toContain("数据设置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings server route without bottom navigation", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/settings/server"] }, createElement(AppShell))
    );

    expect(html).toContain("服务器配置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders category settings routes without bottom navigation", () => {
    const listHtml = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/settings/categories"] }, createElement(AppShell))
    );
    const detailHtml = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/settings/categories/category-1"] }, createElement(AppShell))
    );

    expect(listHtml).toContain("分类列表页");
    expect(detailHtml).toContain("分类详情页");
    expect(listHtml).not.toContain("时间轴");
    expect(detailHtml).not.toContain("统计");
  });

  it("passes the resume refresh key to time-sensitive pages", () => {
    const timelineHtml = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/"] }, createElement(AppShell))
    );
    const entryHtml = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/entries/new"] }, createElement(AppShell))
    );

    expect(timelineHtml).toContain("时间轴页面 0");
    expect(entryHtml).toContain("记录页面 0");
  });
});
