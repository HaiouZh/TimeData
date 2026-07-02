// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../App.js";
import { BottomNavProvider } from "../../contexts/BottomNavContext.js";
import { db } from "../../db/index.js";
import { renderDom, unmount } from "../../test/domHarness.js";

vi.mock("../../hooks/useAppResumeRefresh.ts", () => ({ useAppResumeRefresh: () => {} }));
vi.mock("../../components/AppUpdatePrompt.tsx", () => ({ default: () => null }));
vi.mock("../../components/AndroidBackButtonHandler.tsx", () => ({ default: () => null }));
vi.mock("../../pages/TimelinePage.tsx", () => ({ default: () => createElement("div", null, "时间轴页面") }));
vi.mock("../../pages/EntryPage.tsx", () => ({ default: () => createElement("div", null, "记录页面") }));
vi.mock("../../pages/QuickNotesPage.tsx", () => ({ default: () => createElement("div", null, "速记页面") }));
vi.mock("../../pages/TodoPage.tsx", () => ({ TodoPage: () => createElement("div", null, "待办页面") }));
vi.mock("../../pages/tracks/TracksListPage.tsx", () => ({ default: () => createElement("div", null, "轨道列表") }));
vi.mock("../../pages/tracks/TrackDetailPage.tsx", () => ({ default: () => createElement("div", null, "轨道详情") }));
vi.mock("../../pages/goals/GoalsListPage.tsx", () => ({ default: () => createElement("div", null, "目标列表") }));
vi.mock("../../pages/goals/GoalDetailPage.tsx", () => ({ default: () => createElement("div", null, "目标详情") }));
vi.mock("../../pages/StatsPage.tsx", () => ({ default: () => createElement("div", null, "统计入口") }));
vi.mock("../../pages/TimeStatsPage.tsx", () => ({ default: () => createElement("div", null, "时间统计") }));
vi.mock("../../pages/HealthStatsPage.tsx", () => ({ default: () => createElement("div", null, "健康统计") }));
vi.mock("../../pages/SettingsPage.tsx", () => ({ default: () => createElement("div", null, "设置首页") }));
vi.mock("../../pages/settings/SettingsAdminInsightsPage.tsx", () => ({ default: () => createElement("div", null, "后台洞察") }));
vi.mock("../../pages/settings/SettingsCategoriesPage.tsx", () => ({ default: () => createElement("div", null, "分类设置") }));
vi.mock("../../pages/settings/SettingsCategoryDetailPage.tsx", () => ({ default: () => createElement("div", null, "分类详情") }));
vi.mock("../../pages/settings/SettingsDataPage.tsx", () => ({ default: () => createElement("div", null, "数据设置") }));
vi.mock("../../pages/settings/SettingsGarminPage.tsx", () => ({ default: () => createElement("div", null, "Garmin 设置") }));
vi.mock("../../pages/settings/SettingsHealthRangePage.tsx", () => ({ default: () => createElement("div", null, "健康范围") }));
vi.mock("../../pages/settings/SettingsInsightsPage.tsx", () => ({ default: () => createElement("div", null, "洞察设置") }));
vi.mock("../../pages/settings/SettingsNavPage.tsx", () => ({ SettingsNavPage: () => createElement("div", null, "导航设置") }));
vi.mock("../../pages/settings/SettingsServerPage.tsx", () => ({ default: () => createElement("div", null, "服务端设置") }));
vi.mock("../../pages/settings/SettingsStatsLayoutPage.tsx", () => ({ default: () => createElement("div", null, "统计布局") }));
vi.mock("../../pages/settings/SettingsTracksPage.tsx", () => ({ SettingsTracksPage: () => createElement("div", null, "轨道设置") }));

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      media: "(min-width: 1024px)",
      matches,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

async function render(initialEntry: string) {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(BottomNavProvider, null, createElement(AppShell)),
    ),
  );
}

async function waitForDom(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
  throw new Error("Timed out waiting for DOM update");
}

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("AppShell responsive navigation", () => {
  it("renders mobile bottom nav below 1024px and no desktop sidebar", async () => {
    installMatchMedia(false);
    const { host, root } = await render("/");

    expect(host.querySelector('nav[aria-label="主导航"]')).not.toBeNull();
    expect(host.querySelector('aside[aria-label="桌面主导航"]')).toBeNull();

    await unmount(root);
  });

  it("renders desktop sidebar at 1024px and no mobile bottom nav", async () => {
    installMatchMedia(true);
    const { host, root } = await render("/");

    expect(host.querySelector('aside[aria-label="桌面主导航"]')).not.toBeNull();
    expect(host.querySelector('nav[aria-label="主导航"]')).toBeNull();
    expect(host.querySelector('aside a[href="/tracks"][aria-label="轨道"]')).not.toBeNull();

    await unmount(root);
  });

  it("keeps desktop sidebar on detail and settings child routes", async () => {
    installMatchMedia(true);
    const { host, root } = await render("/tracks/track-1");

    expect(host.textContent).toContain("轨道详情");
    expect(host.querySelector('aside[aria-label="桌面主导航"]')).not.toBeNull();
    expect(host.querySelector('nav[aria-label="主导航"]')).toBeNull();

    await unmount(root);
  });

  it("uses desktop more placement from synced settings", async () => {
    installMatchMedia(true);
    await db.settings.put({
      key: "nav.desktopSidebar.v1",
      value: JSON.stringify({ items: [{ to: "/tracks", placement: "more" }] }),
      updatedAt: "2026-06-23T00:00:00.000Z",
    });

    const { host, root } = await render("/");

    await waitForDom(() => host.querySelector('aside button[aria-label="更多导航"]') !== null);
    expect(host.querySelector('aside > a[href="/tracks"]')).toBeNull();
    expect(host.querySelector('aside button[aria-label="更多导航"]')).not.toBeNull();

    await unmount(root);
  });
});
