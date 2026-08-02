import { describe, expect, it } from "vitest";
import { findStuckDivider } from "./currentDate.js";

const H = 28; // 日期药丸行高，取值不影响判定逻辑，只要各用例内自洽

describe("findStuckDivider", () => {
  it("命中正粘在顶部的那条", () => {
    const dividers = [
      { label: "6月1日", top: -10, height: H },
      { label: "6月2日", top: 300, height: H },
    ];
    expect(findStuckDivider(dividers, 8)?.label).toBe("6月1日");
  });

  it("已被完全顶出视口的不再命中", () => {
    expect(findStuckDivider([{ label: "6月1日", top: -40, height: H }], 8)).toBeNull();
  });

  it("还没滚到粘住位置的不命中", () => {
    expect(findStuckDivider([{ label: "6月1日", top: 200, height: H }], 8)).toBeNull();
  });

  it("恰好停在粘住位置时命中（上界含等号）", () => {
    expect(findStuckDivider([{ label: "今天", top: 8, height: H }], 8)?.label).toBe("今天");
  });

  it("恰好到被顶出的临界点时仍命中（下界含等号）", () => {
    expect(findStuckDivider([{ label: "今天", top: -H, height: H }], 8)?.label).toBe("今天");
  });

  // 这个几何只在「每天各自成一个 sticky 包含块」的 DOM 下才会出现（页面层按天包一层 div，见
  // dayGroups.ts）：下一天的包裹上来时会把上一天的日期条推成负 top。拍平渲染时 sticky 兄弟互不
  // 推挤，两条都会恒停在 stickyTop，这条用例描述的形态根本不存在，取第一条也就没了意义。
  it("两条同时落在区间时取更早的那条——它正被下一条顶出，此刻仍占着顶部", () => {
    const dividers = [
      { label: "6月1日", top: -20, height: H },
      { label: "6月2日", top: 5, height: H },
    ];
    expect(findStuckDivider(dividers, 8)?.label).toBe("6月1日");
  });

  it("空列表返回 null", () => {
    expect(findStuckDivider([], 8)).toBeNull();
  });
});
