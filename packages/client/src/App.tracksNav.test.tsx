// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./App.js";
import { BottomNavProvider } from "./contexts/BottomNavContext.js";
import { renderDom, unmount } from "./test/domHarness.js";

vi.mock("./hooks/useAppResumeRefresh.ts", () => ({ useAppResumeRefresh: () => {} }));
vi.mock("./components/AppUpdatePrompt.tsx", () => ({ default: () => null }));
vi.mock("./components/AndroidBackButtonHandler.tsx", () => ({ default: () => null }));
vi.mock("./pages/TimelinePage.tsx", () => ({ default: () => createElement("div", null, "时间轴占位") }));
vi.mock("./pages/tracks/TracksListPage.tsx", () => ({ default: () => createElement("div", null, "轨道列表占位") }));
vi.mock("./pages/tracks/TrackDetailPage.tsx", () => ({ default: () => createElement("div", null, "轨道详情占位") }));
vi.mock("./lib/settings/navVisibleTabsSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/settings/navVisibleTabsSetting.ts")>();
  return { ...actual, useVisibleTabs: () => [...actual.CONFIGURABLE_TABS] };
});

async function render(initial: string) {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initial] },
      createElement(BottomNavProvider, null, createElement(AppShell)),
    ),
  );
}

describe("AppShell tracks nav", () => {
  it("shows a 轨道 tab linking to /tracks", async () => {
    const { host, root } = await render("/");
    const link = host.querySelector('nav a[href="/tracks"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("轨道");
    await unmount(root);
  });

  it("hides the bottom nav on a track detail route", async () => {
    const { host, root } = await render("/tracks/track-1");
    expect(host.querySelector("nav")).toBeNull();
    await unmount(root);
  });
});
