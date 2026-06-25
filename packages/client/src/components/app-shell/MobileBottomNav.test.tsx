// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../../contexts/BottomNavContext.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { MobileBottomNav } from "./MobileBottomNav.js";

vi.mock("../../lib/settings/navVisibleTabsSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/navVisibleTabsSetting.ts")>();
  return { ...actual, useVisibleTabs: () => ["/quick-notes", "/"] };
});

function HideBottomNavButton() {
  const { setHidden } = useBottomNav();
  return createElement("button", { type: "button", "data-testid": "hide-nav", onClick: () => setHidden(true) }, "hide");
}

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

  it("closes the more menu when the bottom nav becomes hidden", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        null,
        createElement(BottomNavProvider, null, createElement(HideBottomNavButton), createElement(MobileBottomNav)),
      ),
    );

    const more = host.querySelector('button[aria-label="更多导航"]');
    expect(more).not.toBeNull();

    await click(more);
    expect(host.querySelector('nav a[href="/todo"][aria-label="待办"]')).not.toBeNull();

    await click(host.querySelector('[data-testid="hide-nav"]'));

    expect(host.querySelector('nav a[href="/todo"][aria-label="待办"]')).toBeNull();
    expect(more?.getAttribute("aria-expanded")).toBe("false");

    await unmount(root);
  });
});
