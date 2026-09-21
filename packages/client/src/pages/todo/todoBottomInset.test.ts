import { describe, expect, it } from "vitest";
import { todoBottomInset } from "./todoBottomInset.js";

describe("todoBottomInset", () => {
  it("多选态 barPx = max(composer, bar)、无 barPxWhileKeyboard", () => {
    expect(
      todoBottomInset({
        selectionMode: true,
        composerHeightPx: 80,
        composerScrollHidden: false,
        navOffsetBasePx: 49,
        selectionBarHeightPx: 44,
      }),
    ).toEqual({ barPx: 80, navOffsetBasePx: 49 });
  });

  it("非多选未藏 barPx = composer、barPxWhileKeyboard = composer", () => {
    expect(
      todoBottomInset({
        selectionMode: false,
        composerHeightPx: 80,
        composerScrollHidden: false,
        navOffsetBasePx: 49,
        selectionBarHeightPx: 44,
      }),
    ).toEqual({ barPx: 80, barPxWhileKeyboard: 80, navOffsetBasePx: 49 });
  });

  it("非多选滚动藏起 barPx = 0 但 barPxWhileKeyboard = composer", () => {
    expect(
      todoBottomInset({
        selectionMode: false,
        composerHeightPx: 80,
        composerScrollHidden: true,
        navOffsetBasePx: 49,
        selectionBarHeightPx: 44,
      }),
    ).toEqual({ barPx: 0, barPxWhileKeyboard: 80, navOffsetBasePx: 49 });
  });
});
