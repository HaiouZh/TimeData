// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../../contexts/BottomNavContext.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { MobileBottomNav } from "./MobileBottomNav.js";

vi.mock("../../lib/settings/navVisibleTabsSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/navVisibleTabsSetting.ts")>();
  return { ...actual, useVisibleTabs: () => ["/quick-notes", "/"] };
});

describe("MobileBottomNav", () => {
  it("keeps visible mobile tabs icon-only while exposing accessible labels", async () => {
    const retiredTextModuleClass = "text-" + "mo" + "d-";
    const legacyPrimaryClass = "bg-" + "blue-600";
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/quick-notes"] },
        createElement(BottomNavProvider, null, createElement(MobileBottomNav)),
      ),
    );

    const nav = host.querySelector('nav[aria-label="主导航"]');
    const quickNotes = host.querySelector('nav a[href="/quick-notes"][aria-label="记录"]');
    expect(quickNotes).not.toBeNull();
    expect(quickNotes?.textContent).toBe("");
    expect(quickNotes?.className).toContain("bg-accent-soft");
    expect(quickNotes?.className).toContain("text-accent");
    expect(quickNotes?.className).toContain("ring-accent/30");
    expect(nav?.textContent).not.toContain("记录");
    expect(nav?.textContent).not.toContain("时间轴");
    expect(host.innerHTML).not.toContain(retiredTextModuleClass);
    expect(host.innerHTML).not.toContain(legacyPrimaryClass);

    await unmount(root);
  });

  it("does not render hidden mobile routes or a more button", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(BottomNavProvider, null, createElement(MobileBottomNav))),
    );

    expect(host.querySelector('nav a[href="/todo"]')).toBeNull();
    expect(host.querySelector('button[aria-label="更多导航"]')).toBeNull();
    expect(host.querySelector('a[href="/settings"][aria-label="设置"]')).not.toBeNull();

    await unmount(root);
  });
});
