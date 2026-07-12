import { createElement } from "react";
import { prerender } from "react-dom/static";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./App.js";
import { BottomNavProvider } from "./contexts/BottomNavContext.js";

vi.mock("./components/AppUpdatePrompt.tsx", () => ({
  default: () => null,
}));

vi.mock("./lib/settings/navVisibleTabsSetting.ts", () => ({
  useVisibleTabs: () => ["/quick-notes", "/", "/todo", "/stats/time", "/stats/health"],
}));

vi.mock("./pages/TimelinePage.tsx", () => ({
  default: () => createElement("div", null, "时间轴页面"),
}));

vi.mock("./pages/EntryPage.tsx", () => ({
  default: () => createElement("div", null, "记录页面"),
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

vi.mock("./pages/settings/SettingsMorePage.tsx", () => ({
  default: () => createElement("div", null, "更多功能页"),
}));

vi.mock("./pages/settings/SettingsNavPage.tsx", () => ({
  SettingsNavPage: () => createElement("div", null, "底部导航设置页"),
}));

async function readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

// prerender 会等 Suspense/lazy 解析完再吐 HTML，路由懒加载后 renderToStaticMarkup 只能渲出 fallback。
async function renderAppShell(initialEntry: string): Promise<string> {
  const { prelude } = await prerender(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(BottomNavProvider, null, createElement(AppShell)),
    ),
  );
  return readStreamToString(prelude);
}

function installMobileMatchMedia() {
  if (typeof window === "undefined") return;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  installMobileMatchMedia();
});

describe("AppShell settings routes", () => {
  it("renders settings data route without bottom navigation", async () => {
    const html = await renderAppShell("/settings/data");

    expect(html).toContain("数据设置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings server route without bottom navigation", async () => {
    const html = await renderAppShell("/settings/server");

    expect(html).toContain("服务器配置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings insights route without bottom navigation", async () => {
    const html = await renderAppShell("/settings/insights");

    expect(html).toContain("数据洞察设置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings nav route without bottom navigation", async () => {
    const html = await renderAppShell("/settings/nav");

    expect(html).toContain("底部导航设置页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders settings more route without bottom navigation", async () => {
    const html = await renderAppShell("/settings/more");

    expect(html).toContain("更多功能页");
    expect(html).not.toContain("时间轴");
    expect(html).not.toContain("统计");
  });

  it("renders category settings routes without bottom navigation", async () => {
    const listHtml = await renderAppShell("/settings/categories");
    const detailHtml = await renderAppShell("/settings/categories/category-1");

    expect(listHtml).toContain("分类列表页");
    expect(detailHtml).toContain("分类详情页");
    expect(listHtml).not.toContain("时间轴");
    expect(detailHtml).not.toContain("统计");
  });

  it("renders the timeline and entry pages", async () => {
    const timelineHtml = await renderAppShell("/");
    const entryHtml = await renderAppShell("/entries/new");

    expect(timelineHtml).toContain("时间轴页面");
    expect(entryHtml).toContain("记录页面");
  });

  it("renders quick notes route and pure-icon bottom navigation entries", async () => {
    const html = await renderAppShell("/quick-notes");

    expect(html).toContain("速记页面");
    expect(html).toContain('aria-label="记录"');
    expect(html).toContain('aria-label="时间轴"');
    expect(html).toContain('aria-label="待办"');
    expect(html).toContain('aria-label="时间统计"');
    expect(html).toContain('aria-label="健康统计"');
    expect(html).toContain('aria-label="设置"');
    expect(html).not.toContain(">记录</a>");
    expect(html).not.toContain(">时间轴</a>");
  });

  it("renders todo route and bottom navigation entry", async () => {
    const html = await renderAppShell("/todo");

    expect(html).toContain("待办页面");
    expect(html).toContain("待办");
  });

  it("renders separate time and health stats routes", async () => {
    expect(await renderAppShell("/stats/time")).toContain("时间统计页面");
    expect(await renderAppShell("/stats/health")).toContain("健康统计页面");
  });
});
