import { describe, expect, it } from "vitest";
import {
  initialNavScrollState,
  NAV_SCROLL_HIDE_THRESHOLD_PX,
  NAV_SCROLL_NEAR_TOP_PX,
  NAV_SCROLL_SHOW_THRESHOLD_PX,
  type NavScrollState,
  resolveNavVisibility,
} from "./navScroll.js";

/** 依次喂入一串 scrollTop，返回最终状态，方便描述「连续滚动」场景。 */
function feed(start: NavScrollState, scrollTops: number[]): NavScrollState {
  return scrollTops.reduce((state, top) => resolveNavVisibility(state, top), start);
}

describe("resolveNavVisibility", () => {
  it("接近顶部时恒显示并清空累计器", () => {
    const hiddenState: NavScrollState = { lastScrollTop: 400, accum: 99, hidden: true };
    const next = resolveNavVisibility(hiddenState, NAV_SCROLL_NEAR_TOP_PX);
    expect(next.hidden).toBe(false);
    expect(next.accum).toBe(0);
    expect(next.lastScrollTop).toBe(NAV_SCROLL_NEAR_TOP_PX);
  });

  it("连续缓慢下滑累计越过隐藏阈值后隐藏", () => {
    // 以 200 为基线起步（模拟挂载/路由切换时的种子），每次 +8，累计需超过 32 才隐藏
    const start = initialNavScrollState(200);
    const afterFew = feed(start, [208, 216]); // 累计 16，未到阈值
    expect(afterFew.hidden).toBe(false);

    const afterMore = feed(afterFew, [224, 232, 240]); // 继续下滑越过 32
    expect(afterMore.hidden).toBe(true);
  });

  it("隐藏后向上累计超过显示阈值即恢复", () => {
    const hidden = feed(initialNavScrollState(200), [240, 280]);
    expect(hidden.hidden).toBe(true);

    const shown = feed(hidden, [268]); // 一次上滑 -12，达到显示阈值
    expect(shown.hidden).toBe(false);
  });

  it("方向反转时重置累计器，未达阈值的反向单步不误触发", () => {
    // 先向下累计 20（未到 32，仍显示）
    const down = feed(initialNavScrollState(200), [210, 220]);
    expect(down.hidden).toBe(false);
    expect(down.accum).toBe(20);

    // 一次小幅上滑 -5：方向反转应把累计重置为 -5，而非把已有正累计抵消后保留
    const reversed = resolveNavVisibility(down, 215);
    expect(reversed.accum).toBe(-5);
    expect(reversed.hidden).toBe(false);
  });

  it("微小抖动（不足阈值的来回）不翻转可见性", () => {
    const jittered = feed(initialNavScrollState(200), [203, 200, 203, 200, 203]);
    expect(jittered.hidden).toBe(false);
  });

  it("同位置（delta 为 0）保持可见性不变", () => {
    const hidden = feed(initialNavScrollState(200), [240, 280]);
    const same = resolveNavVisibility(hidden, 280);
    expect(same.hidden).toBe(true);
    expect(same.lastScrollTop).toBe(280);
  });

  it("阈值常量为合理的滞回关系（下滑难、上滑易、近顶有缓冲）", () => {
    expect(NAV_SCROLL_HIDE_THRESHOLD_PX).toBeGreaterThan(NAV_SCROLL_SHOW_THRESHOLD_PX);
    expect(NAV_SCROLL_NEAR_TOP_PX).toBeGreaterThan(0);
  });
});
