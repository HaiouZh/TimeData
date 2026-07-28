import { describe, expect, it } from "vitest";
import { MAIN_NAV_ITEMS } from "./navRegistry.js";
import { faviconDataUriForPath } from "./routeFavicon.js";

function decode(uri: string | null): string {
  expect(uri).toMatch(/^data:image\/svg\+xml,/);
  return decodeURIComponent((uri as string).replace("data:image/svg+xml,", ""));
}

describe("faviconDataUriForPath", () => {
  it("returns the todo module glyph for /todo", () => {
    const svg = decode(faviconDataUriForPath("/todo"));
    // ListChecks 字形以这段路径开头
    expect(svg).toContain("M224,128a8,8,0,0,1-8,8H128");
  });

  it("maps deep routes back to their primary module", () => {
    const goalDeep = decode(faviconDataUriForPath("/goals/abc"));
    const goalRoot = decode(faviconDataUriForPath("/goals"));
    expect(goalDeep).toBe(goalRoot);
  });

  it("gives different glyphs to different modules", () => {
    expect(faviconDataUriForPath("/todo")).not.toBe(faviconDataUriForPath("/tracks"));
    expect(faviconDataUriForPath("/tracks")).not.toBe(faviconDataUriForPath("/goals"));
  });

  it("wraps the glyph in a rounded tile", () => {
    const svg = decode(faviconDataUriForPath("/tracks"));
    expect(svg).toContain('rx="56"');
    expect(svg).toContain('viewBox="0 0 256 256"');
  });

  // ICON_PATHS 是手抄的字形常量，导航新增/改名图标时全靠人记得同步；
  // 漏了的话 faviconDataUriForPath 静默返回 null（标签页悄悄退回默认图标）。
  it.each(MAIN_NAV_ITEMS.map((item) => [item.to, item.iconName]))(
    "%s 的图标 %s 在 ICON_PATHS 里有命中",
    (to, _iconName) => {
      expect(faviconDataUriForPath(to)).not.toBeNull();
    },
  );
});
