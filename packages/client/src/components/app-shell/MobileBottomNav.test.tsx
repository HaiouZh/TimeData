// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../../contexts/BottomNavContext.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { MobileBottomNav } from "./MobileBottomNav.js";

vi.mock("../../lib/settings/navVisibleTabsSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/navVisibleTabsSetting.ts")>();
  return { ...actual, useVisibleTabs: () => ["/quick-notes", "/"] };
});

describe("MobileBottomNav", () => {
  it("opens hidden mobile routes from the more button", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(BottomNavProvider, null, createElement(MobileBottomNav))),
    );

    expect(host.querySelector('nav a[href="/todo"]')).toBeNull();
    const more = host.querySelector('button[aria-label="更多导航"]');
    expect(more).not.toBeNull();

    await click(more);

    const hiddenTodo = host.querySelector('nav a[href="/todo"][aria-label="待办"]');
    expect(hiddenTodo).not.toBeNull();
    expect(hiddenTodo?.textContent).toContain("待办");

    await unmount(root);
  });
});
