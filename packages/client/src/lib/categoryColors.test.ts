import { describe, expect, it } from "vitest";
import {
  CATEGORY_COLOR_PALETTES,
  applyCategoryPaletteByIndex,
  normalizeCategoryColor,
} from "./categoryColors.js";

describe("categoryColors", () => {
  it("defines three named palettes with usable CSS hex colors", () => {
    expect(Object.keys(CATEGORY_COLOR_PALETTES)).toEqual(["classic", "morandi", "macaron"]);

    for (const palette of Object.values(CATEGORY_COLOR_PALETTES)) {
      expect(palette.colors.length).toBeGreaterThanOrEqual(14);
      expect(palette.colors.every((color) => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
    }
  });

  it("normalizes valid colors to uppercase #RRGGBB", () => {
    expect(normalizeCategoryColor("#4a90d9")).toBe("#4A90D9");
    expect(normalizeCategoryColor("#ABCDEF")).toBe("#ABCDEF");
  });

  it("rejects invalid color strings", () => {
    expect(() => normalizeCategoryColor("4A90D9")).toThrow("颜色格式不正确。");
    expect(() => normalizeCategoryColor("#12345")).toThrow("颜色格式不正确。");
    expect(() => normalizeCategoryColor("#12345678")).toThrow("颜色格式不正确。");
    expect(() => normalizeCategoryColor("red")).toThrow("颜色格式不正确。");
  });

  it("cycles palette colors by index", () => {
    const palette = CATEGORY_COLOR_PALETTES.classic.colors;

    expect(applyCategoryPaletteByIndex("classic", 0)).toBe(palette[0]);
    expect(applyCategoryPaletteByIndex("classic", palette.length)).toBe(palette[0]);
    expect(applyCategoryPaletteByIndex("classic", palette.length + 1)).toBe(palette[1]);
    expect(applyCategoryPaletteByIndex("classic", -1)).toBe(palette[palette.length - 1]);
    expect(applyCategoryPaletteByIndex("classic", -palette.length)).toBe(palette[0]);
  });
});
