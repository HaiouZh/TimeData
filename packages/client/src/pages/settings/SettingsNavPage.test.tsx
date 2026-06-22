// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import { readVisibleTabs } from "../../lib/settings/navVisibleTabsSetting.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { SettingsNavPage } from "./SettingsNavPage.js";

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  return renderDom(createElement(MemoryRouter, null, createElement(SettingsNavPage)));
}

async function waitForTabs(predicate: (tabs: string[]) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (predicate(await readVisibleTabs())) return;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for nav.visibleTabs.v1");
}

describe("SettingsNavPage", () => {
  it("toggles a tab off and persists", async () => {
    const { host, root } = await renderPage();
    await click(host.querySelector('[role="switch"][aria-label="健康"]'));
    await waitForTabs((tabs) => tabs.includes("/stats/time") && !tabs.includes("/stats/health"));
    await unmount(root);
  });

  it("offers 轨道, 时间 and 健康 as separate toggles, not 统计", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[role="switch"][aria-label="轨道"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="目标"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="时间"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="健康"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="统计"]')).toBeNull();
    await unmount(root);
  });

  it("does not offer 设置 as toggleable", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[role="switch"][aria-label="设置"]')).toBeNull();
    await unmount(root);
  });
});
