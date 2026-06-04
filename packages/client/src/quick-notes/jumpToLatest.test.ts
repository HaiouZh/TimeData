import { describe, expect, it } from "vitest";
import { shouldShowJumpToLatest } from "./jumpToLatest.js";

describe("shouldShowJumpToLatest", () => {
  it("贴底且在最新窗口时隐藏", () => {
    expect(shouldShowJumpToLatest({ atBottom: true, atLatest: true })).toBe(false);
  });

  it("上滑离开底部但仍在最新窗口时显示", () => {
    expect(shouldShowJumpToLatest({ atBottom: false, atLatest: true })).toBe(true);
  });

  it("处于历史窗口时显示", () => {
    expect(shouldShowJumpToLatest({ atBottom: true, atLatest: false })).toBe(true);
  });
});
