import { describe, expect, it } from "vitest";
import { composeBottomInset, composeFlowKeyboardInset } from "./bottomInset.js";

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

describe("composeFlowKeyboardInset（文档流容器的键盘让位）", () => {
  /**
   * 这条是日记页黑条的本体闸：底栏在文档流里占着 49px 时，容器底边离屏幕底就有 49px，
   * 让位量必须扣掉这一段——不扣就多让一个底栏高，textarea 底边停在键盘上沿之上 49px，
   * 中间露出容器自己的 bg-page（真机表现即「输入法上方一行黑条」）。
   * 拆了这个扣减（改回直接吃 keyboardHeightPx）这条即红。
   */
  it("底栏在文档流里时，让位量扣掉底栏占位（含安全区接口）", () => {
    expect(composeFlowKeyboardInset({ keyboardHeightPx: 300, navOffsetPx: 49 })).toBe(
      "max(0px, calc(300px - 49px - var(--safe-bottom)))",
    );
  });

  it("底栏不在场（宽屏 / 已隐）时让整个遮挡量，不留 max/calc 包装", () => {
    expect(composeFlowKeyboardInset({ keyboardHeightPx: 300, navOffsetPx: 0 })).toBe("300px");
  });

  /** 回归护栏：键盘不在场（桌面浏览器 / 收起 / 安卓壳已让位）时恒零让位。 */
  it("keyboardHeightPx=0 时恒为 0px", () => {
    expect(composeFlowKeyboardInset({ keyboardHeightPx: 0, navOffsetPx: 49 })).toBe("0px");
    expect(composeFlowKeyboardInset({ keyboardHeightPx: 0, navOffsetPx: 0 })).toBe("0px");
  });

  it("Math.ceil：遮挡量为小数时向上取整（与 composeBottomInset 同口径）", () => {
    expect(composeFlowKeyboardInset({ keyboardHeightPx: 299.2, navOffsetPx: 0 })).toBe("300px");
    expect(composeFlowKeyboardInset({ keyboardHeightPx: 299.2, navOffsetPx: 49 })).toBe(
      "max(0px, calc(300px - 49px - var(--safe-bottom)))",
    );
  });
});
