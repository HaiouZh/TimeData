import { describe, expect, it } from "vitest";
import { composeBottomInset } from "./bottomInset.js";

describe("composeBottomInset（底部避让量单一合成来源）", () => {
  /**
   * 回归护栏：键盘高 = 0 时（桌面浏览器 / 无键盘场景恒如此），结果必须与合成前
   * 「批 1」逐值完全相等——即 ceil(barHeightPx + navOffsetPx)，不因为引入 keyboardHeightPx
   * 参数就多算或少算一分。任何偏差都是回归。
   */
  it("keyboardHeightPx=0 时结果等于 ceil(barHeightPx + navOffsetPx)（批 1 逐值不变）", () => {
    const cases = [
      { barHeightPx: 128, navOffsetPx: 56 },
      { barHeightPx: 16, navOffsetPx: 0 },
      { barHeightPx: 0, navOffsetPx: 56 },
      { barHeightPx: 0, navOffsetPx: 0 },
      { barHeightPx: 42, navOffsetPx: 56 },
      { barHeightPx: 192.4, navOffsetPx: 0 },
    ];
    for (const { barHeightPx, navOffsetPx } of cases) {
      expect(composeBottomInset({ barHeightPx, navOffsetPx, keyboardHeightPx: 0 })).toBe(
        Math.ceil(barHeightPx + navOffsetPx),
      );
    }
  });

  it("keyboardHeightPx 非 0 时按三者之和递增", () => {
    const withoutKeyboard = composeBottomInset({ barHeightPx: 128, navOffsetPx: 56, keyboardHeightPx: 0 });
    const withKeyboard = composeBottomInset({ barHeightPx: 128, navOffsetPx: 56, keyboardHeightPx: 300 });
    expect(withKeyboard).toBe(withoutKeyboard + 300);
    expect(withKeyboard).toBeGreaterThan(withoutKeyboard);
  });

  it("键盘弹起、nav 已隐（navOffsetPx=0）时，合成 = bar + keyboard", () => {
    expect(composeBottomInset({ barHeightPx: 128, navOffsetPx: 0, keyboardHeightPx: 300 })).toBe(428);
  });

  it("Math.ceil：三者之和为小数时向上取整", () => {
    expect(composeBottomInset({ barHeightPx: 100.1, navOffsetPx: 0, keyboardHeightPx: 0 })).toBe(101);
    expect(composeBottomInset({ barHeightPx: 100.5, navOffsetPx: 0.4, keyboardHeightPx: 0 })).toBe(101);
    expect(composeBottomInset({ barHeightPx: 100, navOffsetPx: 0, keyboardHeightPx: 0.1 })).toBe(101);
  });

  it("三者皆 0 时结果为 0", () => {
    expect(composeBottomInset({ barHeightPx: 0, navOffsetPx: 0, keyboardHeightPx: 0 })).toBe(0);
  });
});
