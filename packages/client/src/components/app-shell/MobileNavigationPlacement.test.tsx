// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../../contexts/BottomNavContext.js";
import { db } from "../../db/index.js";
import { NAV_VISIBLE_TABS_KEY } from "../../lib/settings/navVisibleTabsSetting.js";
import SettingsMorePage from "../../pages/settings/SettingsMorePage.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { MobileBottomNav } from "./MobileBottomNav.js";

const rawSetting = vi.hoisted(() => ({
  value: JSON.stringify(["/quick-notes", "/", "/todo"]),
}));

vi.mock("../../lib/settings/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/index.ts")>();
  return { ...actual, useSetting: (key: string) => (key === NAV_VISIBLE_TABS_KEY ? rawSetting.value : null) };
});

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
  rawSetting.value = JSON.stringify(["/quick-notes", "/", "/todo"]);
});

describe("mobile navigation placement", () => {
  it("places each configurable route in either the bottom bar or Settings > More, never both", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        null,
        createElement(
          BottomNavProvider,
          null,
          createElement(MobileBottomNav),
          createElement("div", { "data-testid": "more-page" }, createElement(SettingsMorePage)),
        ),
      ),
    );

    const bottomNav = host.querySelector('nav[aria-label="主导航"]');
    const morePage = host.querySelector('[data-testid="more-page"]');

    expect(bottomNav?.querySelector('a[href="/todo"]')).not.toBeNull();
    expect(morePage?.querySelector('a[href="/todo"]')).toBeNull();
    expect(bottomNav?.querySelector('a[href="/stats/health"]')).toBeNull();
    expect(morePage?.querySelector('a[href="/stats/health"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="更多导航"]')).toBeNull();

    await unmount(root);
  });
});
