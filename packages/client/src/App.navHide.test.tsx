// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./App.js";
import { BottomNavProvider, useBottomNav } from "./contexts/BottomNavContext.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function render(element: ReactElement): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return { host, root };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("AppShell bottom nav hide", () => {
  it("collapses the nav height when hidden so the content area reclaims the space", async () => {
    const { host, root } = await render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(BottomNavProvider, null, createElement(HideToggle), createElement(AppShell)),
      ),
    );

    const nav = host.querySelector("nav");
    expect(nav).toBeInstanceOf(HTMLElement);
    // 显示态：占据固定高度
    expect((nav as HTMLElement).style.height).toBe("49px");
    // 用 transform 隐藏不会释放 flex 占位，必须靠塌缩高度
    expect((nav as HTMLElement).className).not.toContain("translate-y");

    await act(async () => {
      (host.querySelector('[data-testid="toggle"]') as HTMLButtonElement).click();
    });

    // 隐藏态：高度塌缩为 0 → 同列的 <main>（flex-1）补上这段空间
    expect((host.querySelector("nav") as HTMLElement).style.height).toBe("0px");

    await act(async () => root.unmount());
  });
});
