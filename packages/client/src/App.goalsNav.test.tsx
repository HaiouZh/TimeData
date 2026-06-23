// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./App.js";
import { BottomNavProvider } from "./contexts/BottomNavContext.js";
import { renderDom, unmount } from "./test/domHarness.js";

vi.mock("./hooks/useAppResumeRefresh.ts", () => ({ useAppResumeRefresh: () => {} }));
vi.mock("./components/AppUpdatePrompt.tsx", () => ({ default: () => null }));
vi.mock("./components/AndroidBackButtonHandler.tsx", () => ({ default: () => null }));
vi.mock("./pages/TimelinePage.tsx", () => ({ default: () => createElement("div", null, "时间轴占位") }));
vi.mock("./pages/goals/GoalsListPage.tsx", () => ({ default: () => createElement("div", null, "目标列表占位") }));
vi.mock("./pages/goals/GoalDetailPage.tsx", () => ({ default: () => createElement("div", null, "目标详情占位") }));
vi.mock("./lib/settings/navVisibleTabsSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/settings/navVisibleTabsSetting.ts")>();
  return { ...actual, useVisibleTabs: () => [...actual.CONFIGURABLE_TABS] };
});

function installMobileMatchMedia() {
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

async function render(initial: string) {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initial] },
      createElement(BottomNavProvider, null, createElement(AppShell)),
    ),
  );
}

beforeEach(() => {
  installMobileMatchMedia();
});

describe("AppShell goals nav", () => {
  it("shows a pure-icon 目标 tab linking to /goals", async () => {
    const { host, root } = await render("/");
    const link = host.querySelector('nav a[href="/goals"][aria-label="目标"]');
    expect(link).not.toBeNull();
    expect(link?.textContent?.trim()).toBe("");
    await unmount(root);
  });

  it("hides the bottom nav on a goal detail route", async () => {
    const { host, root } = await render("/goals/goal-1");
    expect(host.textContent).toContain("目标详情占位");
    expect(host.querySelector("nav")).toBeNull();
    await unmount(root);
  });
});
