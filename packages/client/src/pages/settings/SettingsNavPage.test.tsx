// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { readDesktopSidebarConfig } from "../../lib/settings/desktopSidebarSetting.js";
import { readVisibleTabs } from "../../lib/settings/navVisibleTabsSetting.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { SettingsNavPage } from "./SettingsNavPage.js";

vi.mock("../../lib/settings/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/index.ts")>();
  return { ...actual, useSetting: () => null };
});

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  return renderDom(createElement(MemoryRouter, null, createElement(SettingsNavPage)));
}

async function clickAndFlushSettings(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForTabs(predicate: (tabs: string[]) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    if (predicate(await readVisibleTabs())) return;
  }
  throw new Error("Timed out waiting for nav.visibleTabs.v1");
}

async function waitForDesktopConfig(predicate: (items: { to: string; placement: string }[]) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    if (predicate(await readDesktopSidebarConfig())) return;
  }
  throw new Error("Timed out waiting for nav.desktopSidebar.v1");
}

describe("SettingsNavPage", () => {
  it("toggles a tab off and persists", async () => {
    const { host, root } = await renderPage();
    await clickAndFlushSettings(host.querySelector('[role="switch"][aria-label="健康"]'));
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

  it("renders separate mobile and desktop navigation sections with the new mobile placement semantics", async () => {
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("手机底栏");
    expect(host.textContent).toContain("关闭后显示在“设置 > 更多功能”");
    expect(host.textContent).toContain("桌面侧栏");
    expect(host.textContent).toContain("记录");
    expect(host.textContent).toContain("更多");

    await unmount(root);
  });

  it("shows route labels for configuration without module-color identity language", async () => {
    const retiredTextModuleClass = "text-" + "mo" + "d-";
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("记录");
    expect(host.textContent).toContain("时间轴");
    expect(host.textContent).toContain("侧栏");
    expect(host.innerHTML).not.toContain(retiredTextModuleClass);
    expect(host.textContent).not.toContain("模块色");
    expect(host.textContent).not.toContain("彩色模块");

    await unmount(root);
  });

  it("moves a desktop sidebar item down and persists order", async () => {
    const { host, root } = await renderPage();

    await clickAndFlushSettings(host.querySelector('button[aria-label="下移 记录"]'));
    await waitForDesktopConfig((items) => items[0]?.to === "/" && items[1]?.to === "/quick-notes");

    await unmount(root);
  });

  it("moves a desktop sidebar item into more and persists placement", async () => {
    const { host, root } = await renderPage();

    await clickAndFlushSettings(host.querySelector('button[aria-label="收进更多 轨道"]'));
    await waitForDesktopConfig((items) => items.find((item) => item.to === "/tracks")?.placement === "more");

    await unmount(root);
  });

  it("restores default desktop sidebar config", async () => {
    const { host, root } = await renderPage();

    await clickAndFlushSettings(host.querySelector('button[aria-label="收进更多 轨道"]'));
    await waitForDesktopConfig((items) => items.find((item) => item.to === "/tracks")?.placement === "more");

    await clickAndFlushSettings(host.querySelector('button[aria-label="恢复桌面侧栏默认"]'));
    await waitForDesktopConfig((items) => items.every((item) => item.placement === "primary"));

    await unmount(root);
  });
});
