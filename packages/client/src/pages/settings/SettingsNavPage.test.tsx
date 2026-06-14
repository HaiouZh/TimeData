// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import { readVisibleTabs } from "../../lib/settings/navVisibleTabsSetting.js";
import { SettingsNavPage } from "./SettingsNavPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(SettingsNavPage)));
  });
  return { host, root };
}

async function waitForTabs(expected: (tabs: string[]) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const tabs = await readVisibleTabs();
    if (expected(tabs)) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error("Timed out waiting for nav.visibleTabs.v1");
}

describe("SettingsNavPage", () => {
  it("toggles a tab off and persists", async () => {
    const { host, root } = await renderPage();
    const stats = host.querySelector('input[aria-label="统计"]');

    await act(async () => {
      stats?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForTabs((tabs) => !tabs.includes("/stats"));
    await act(async () => root.unmount());
  });

  it("does not offer 设置 as toggleable", async () => {
    const { host, root } = await renderPage();

    expect(host.querySelector('input[aria-label="设置"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
