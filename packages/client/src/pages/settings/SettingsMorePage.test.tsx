// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIGURABLE_TABS } from "../../lib/settings/navVisibleTabsSetting.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import SettingsMorePage from "./SettingsMorePage.js";

const visibleTabsMock = vi.hoisted(() => ({
  value: ["/quick-notes", "/", "/todo"] as string[],
}));

vi.mock("../../lib/settings/navVisibleTabsSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/navVisibleTabsSetting.ts")>();
  return { ...actual, useVisibleTabs: () => visibleTabsMock.value };
});

async function renderPage() {
  return renderDom(createElement(MemoryRouter, null, createElement(SettingsMorePage)));
}

describe("SettingsMorePage", () => {
  beforeEach(() => {
    visibleTabsMock.value = ["/quick-notes", "/", "/todo"];
  });

  it("lists routes excluded from the mobile bottom bar", async () => {
    const { host, root } = await renderPage();

    expect(host.querySelector('a[href="/tracks"]')?.textContent).toContain("轨道");
    expect(host.querySelector('a[href="/goals"]')?.textContent).toContain("目标");
    expect(host.querySelector('a[href="/stats/time"]')?.textContent).toContain("时间统计");
    expect(host.querySelector('a[href="/todo"]')).toBeNull();
    expect(host.querySelector('a[href="/settings"]')).not.toBeNull();

    await unmount(root);
  });

  it("shows an empty state when every configurable route is in the bottom bar", async () => {
    // 取全量清单而非手抄一份：新增可配置标签（如 /diary）时不会静默漏项
    visibleTabsMock.value = [...CONFIGURABLE_TABS];
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("所有功能都已显示在手机底栏");
    expect(host.querySelector('a[href="/tracks"]')).toBeNull();

    await unmount(root);
  });
});
