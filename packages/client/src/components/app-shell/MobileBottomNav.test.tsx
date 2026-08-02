// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { BOTTOM_NAV_HEIGHT_PX, BottomNavProvider, useBottomNav } from "../../contexts/BottomNavContext.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { MobileBottomNav } from "./MobileBottomNav.js";

vi.mock("../../lib/settings/navVisibleTabsSetting.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settings/navVisibleTabsSetting.ts")>();
  return { ...actual, useVisibleTabs: () => ["/quick-notes", "/"] };
});

function NavToggleHarness() {
  const { hidden, setHidden } = useBottomNav();
  return (
    <div>
      <button type="button" onClick={() => setHidden(!hidden)}>
        toggle
      </button>
      <MobileBottomNav />
    </div>
  );
}

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

  it("隐藏态下高度与底部内边距同时归零（不留一条空带）", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/quick-notes"] },
        createElement(BottomNavProvider, null, createElement(NavToggleHarness)),
      ),
    );

    const nav = host.querySelector('nav[aria-label="主导航"]') as HTMLElement | null;
    expect(nav).not.toBeNull();
    // 可见态基线：总高 = 内容高 + 底部安全区，内边距 = 安全区（nav 背景铺满到屏幕最底）
    expect(nav?.style.height).toBe(`calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom))`);
    expect(nav?.style.paddingBottom).toBe("calc(0px + env(safe-area-inset-bottom))");

    await click(host.querySelector("button"));
    // border-box 下高度与内边距必须同时归零，否则 padding 会撑出 inset 高的一条空带
    expect(nav?.style.height).toBe("0px");
    expect(nav?.style.paddingBottom).toBe("0px");

    await unmount(root);
  });
});
