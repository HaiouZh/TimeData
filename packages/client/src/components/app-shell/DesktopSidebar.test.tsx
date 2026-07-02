// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackAttentionContext } from "../../contexts/TrackAttentionContext.js";
import { DESKTOP_NAV_DEFAULT_ITEMS } from "../../lib/navigation/navRegistry.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { DesktopSidebar } from "./DesktopSidebar.js";

const desktopConfigMock = vi.hoisted(() => ({
  items: [
    { to: "/quick-notes", placement: "primary" },
    { to: "/", placement: "primary" },
    { to: "/todo", placement: "primary" },
    { to: "/tracks", placement: "primary" },
    { to: "/goals", placement: "primary" },
    { to: "/stats/time", placement: "primary" },
    { to: "/stats/health", placement: "primary" },
    { to: "/settings", placement: "primary" },
  ],
}));

vi.mock("../../lib/settings/desktopSidebarSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/desktopSidebarSetting.ts")>();
  return { ...actual, useDesktopSidebarConfig: () => desktopConfigMock.items };
});

async function renderSidebar(initialPath = "/todo") {
  return renderDom(
    createElement(MemoryRouter, { initialEntries: [initialPath] }, createElement(DesktopSidebar)),
  );
}

describe("DesktopSidebar", () => {
  beforeEach(() => {
    desktopConfigMock.items = [...DESKTOP_NAV_DEFAULT_ITEMS];
  });

  it("renders primary navigation with text labels and tokenized active state", async () => {
    const retiredTextModuleClass = "text-" + "mo" + "d-";
    const legacyPrimaryClass = "bg-" + "blue-600";
    const { host, root } = await renderSidebar("/todo");
    const sidebar = host.querySelector('aside[aria-label="桌面主导航"]');
    const active = host.querySelector('a[href="/todo"][aria-label="待办"]');

    expect(sidebar).not.toBeNull();
    expect(active?.textContent).toContain("待办");
    expect(host.querySelector('a[href="/"]')?.textContent).toContain("时间轴");
    expect(active?.className).toContain("bg-accent-soft");
    expect(active?.className).toContain("text-accent");
    expect(active?.className).toContain("ring-accent/30");
    expect(host.innerHTML).not.toContain(retiredTextModuleClass);
    expect(host.innerHTML).not.toContain(legacyPrimaryClass);

    await unmount(root);
  });

  it("shows an attention badge on the tracks tab and nowhere else", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(TrackAttentionContext.Provider, { value: 3 }, createElement(DesktopSidebar)),
      ),
    );
    const tracksLink = host.querySelector('a[href="/tracks"]');
    expect(tracksLink?.querySelector('[data-testid="nav-badge"]')?.textContent).toBe("3");
    expect(host.querySelector('a[href="/todo"] [data-testid="nav-badge"]')).toBeNull();
    await unmount(root);
  });

  it("hides the badge when there is nothing awaiting", async () => {
    const { host, root } = await renderSidebar("/todo");
    expect(host.querySelector('[data-testid="nav-badge"]')).toBeNull();
    await unmount(root);
  });

  it("exposes labeled links inside the more menu", async () => {
    desktopConfigMock.items = [
      { to: "/quick-notes", placement: "primary" },
      { to: "/", placement: "primary" },
      { to: "/todo", placement: "more" },
      { to: "/tracks", placement: "primary" },
      { to: "/goals", placement: "primary" },
      { to: "/stats/time", placement: "primary" },
      { to: "/stats/health", placement: "primary" },
      { to: "/settings", placement: "primary" },
    ];
    const { host, root } = await renderSidebar("/");

    const primaryTodo = host.querySelector('aside > div > a[href="/todo"]');
    expect(primaryTodo).toBeNull();

    await click(host.querySelector('button[aria-label="更多导航"]'));

    const menuTodo = host.querySelector('a[href="/todo"][aria-label="待办"]');
    expect(menuTodo).not.toBeNull();
    expect(menuTodo?.textContent).toContain("待办");

    await unmount(root);
  });
});
