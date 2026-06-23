// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./App.js";
import { BottomNavProvider, useBottomNav } from "./contexts/BottomNavContext.js";
import { click, renderDom, unmount } from "./test/domHarness.js";

vi.mock("./hooks/useAppResumeRefresh.ts", () => ({ useAppResumeRefresh: () => {} }));
vi.mock("./components/AppUpdatePrompt.tsx", () => ({ default: () => null }));
vi.mock("./components/AndroidBackButtonHandler.tsx", () => ({ default: () => null }));
vi.mock("./pages/TimelinePage.tsx", () => ({ default: () => createElement("div", null, "时间轴页面") }));
vi.mock("./pages/EntryPage.tsx", () => ({ default: () => createElement("div", null, "记录页面") }));
vi.mock("./pages/QuickNotesPage.tsx", () => ({ default: () => createElement("div", null, "速记页面") }));
vi.mock("./pages/StatsPage.tsx", () => ({ default: () => createElement("div", null, "统计页面") }));
vi.mock("./pages/SettingsPage.tsx", () => ({ default: () => createElement("div", null, "设置首页") }));
vi.mock("./pages/settings/SettingsCategoriesPage.tsx", () => ({ default: () => createElement("div", null, "分类列表页") }));
vi.mock("./pages/settings/SettingsCategoryDetailPage.tsx", () => ({ default: () => createElement("div", null, "分类详情页") }));
vi.mock("./pages/settings/SettingsServerPage.tsx", () => ({ default: () => createElement("div", null, "服务器配置页") }));
vi.mock("./pages/settings/SettingsDataPage.tsx", () => ({ default: () => createElement("div", null, "数据设置页") }));
vi.mock("./pages/settings/SettingsInsightsPage.tsx", () => ({ default: () => createElement("div", null, "数据洞察设置页") }));

function HideToggle() {
  const { setHidden } = useBottomNav();
  return createElement("button", { type: "button", "data-testid": "toggle", onClick: () => setHidden(true) }, "hide");
}

beforeEach(() => {
  document.body.innerHTML = "";
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
});

describe("AppShell bottom nav hide", () => {
  it("collapses the nav height when hidden so the content area reclaims the space", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(BottomNavProvider, null, createElement(HideToggle), createElement(AppShell)),
      ),
    );

    const nav = host.querySelector('nav[aria-label="主导航"]');
    expect(nav).toBeInstanceOf(HTMLElement);
    // 显示态：占据固定高度
    expect((nav as HTMLElement).style.height).toBe("49px");
    // 用 transform 隐藏不会释放 flex 占位，必须靠塌缩高度
    expect((nav as HTMLElement).className).not.toContain("translate-y");

    await click(host.querySelector('[data-testid="toggle"]'));

    // 隐藏态：高度塌缩为 0 → 同列的 <main>（flex-1）补上这段空间
    expect((host.querySelector('nav[aria-label="主导航"]') as HTMLElement).style.height).toBe("0px");

    await unmount(root);
  });
});
