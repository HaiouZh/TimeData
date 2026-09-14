import { describe, expect, it } from "vitest";
import {
  ROW_SWIPE_FLING_PX_PER_MS,
  ROW_SWIPE_LONG_PRESS_MS,
  ROW_SWIPE_OVERSHOOT_RESISTANCE,
  ROW_SWIPE_SLOP_PX,
  ROW_SWIPE_VELOCITY_STALE_MS,
  releaseVelocity,
  resolveRowSwipeEnd,
  resolveRowSwipeIntent,
  rowSwipeDragOffset,
  rowSwipeRestOffset,
} from "./rowSwipe.ts";

const both = { leading: 56, trailing: 168 };
const trailingOnly = { leading: 0, trailing: 112 };

describe("rowSwipeRestOffset", () => {
  it("打开态停在对应一侧动作条的全宽，关闭态归零", () => {
    expect(rowSwipeRestOffset(null, both)).toBe(0);
    expect(rowSwipeRestOffset("leading", both)).toBe(56);
    expect(rowSwipeRestOffset("trailing", both)).toBe(-168);
  });
});

describe("resolveRowSwipeIntent", () => {
  it("位移没过 slop 一律 pending——此时不判方向、不拦事件，竖滑照常", () => {
    expect(resolveRowSwipeIntent({ dx: -2, dy: 1, heldMs: 16, rest: null, widths: both })).toBe("pending");
    expect(resolveRowSwipeIntent({ dx: -(ROW_SWIPE_SLOP_PX - 1), dy: 0, heldMs: 16, rest: null, widths: both })).toBe(
      "pending",
    );
  });

  it("过 slop 且横向主导才 engage", () => {
    expect(resolveRowSwipeIntent({ dx: -ROW_SWIPE_SLOP_PX, dy: 0, heldMs: 30, rest: null, widths: both })).toBe(
      "engage",
    );
    expect(resolveRowSwipeIntent({ dx: 30, dy: 8, heldMs: 30, rest: null, widths: both })).toBe("engage");
  });

  it("过 slop 后纵向主导 abandon：这一笔归列表滚动", () => {
    expect(resolveRowSwipeIntent({ dx: -8, dy: 30, heldMs: 30, rest: null, widths: both })).toBe("abandon");
    expect(resolveRowSwipeIntent({ dx: 12, dy: 12, heldMs: 30, rest: null, widths: both })).toBe("abandon");
  });

  it("按住不动过长按线才开始移动 = 拖拽排序的起手，不接", () => {
    expect(resolveRowSwipeIntent({ dx: -30, dy: 0, heldMs: ROW_SWIPE_LONG_PRESS_MS, rest: null, widths: both })).toBe(
      "abandon",
    );
    expect(
      resolveRowSwipeIntent({ dx: -30, dy: 0, heldMs: ROW_SWIPE_LONG_PRESS_MS - 1, rest: null, widths: both }),
    ).toBe("engage");
  });

  it("关闭态朝没有动作的一侧滑：abandon，行不跟着动", () => {
    expect(resolveRowSwipeIntent({ dx: 30, dy: 0, heldMs: 30, rest: null, widths: trailingOnly })).toBe("abandon");
    expect(resolveRowSwipeIntent({ dx: -30, dy: 0, heldMs: 30, rest: null, widths: trailingOnly })).toBe("engage");
  });

  it("已打开时往回滑要接：那是在收起", () => {
    expect(resolveRowSwipeIntent({ dx: 30, dy: 0, heldMs: 30, rest: "trailing", widths: trailingOnly })).toBe("engage");
  });
});

describe("rowSwipeDragOffset", () => {
  it("动作条宽度以内 1:1 跟手", () => {
    expect(rowSwipeDragOffset(-100, both)).toBe(-100);
    expect(rowSwipeDragOffset(40, both)).toBe(40);
  });

  it("越过动作条宽度后按阻力比例递减，不硬卡", () => {
    expect(rowSwipeDragOffset(-168 - 100, both)).toBeCloseTo(-168 - 100 * ROW_SWIPE_OVERSHOOT_RESISTANCE);
    expect(rowSwipeDragOffset(56 + 50, both)).toBeCloseTo(56 + 50 * ROW_SWIPE_OVERSHOOT_RESISTANCE);
  });

  it("没有动作的一侧恒钳在 0", () => {
    expect(rowSwipeDragOffset(80, trailingOnly)).toBe(0);
  });
});

describe("releaseVelocity", () => {
  it("最后一次移动后停顿太久，速度作废——停住再松手不算甩", () => {
    expect(releaseVelocity({ velocityX: -1.2, idleMs: ROW_SWIPE_VELOCITY_STALE_MS + 1 })).toBe(0);
    expect(releaseVelocity({ velocityX: -1.2, idleMs: 10 })).toBe(-1.2);
  });
});

describe("resolveRowSwipeEnd", () => {
  it("慢速松手：露出过一半停住打开，不到一半收回", () => {
    expect(resolveRowSwipeEnd({ offset: -85, velocityX: 0, widths: both })).toBe("trailing");
    expect(resolveRowSwipeEnd({ offset: -83, velocityX: 0, widths: both })).toBeNull();
    expect(resolveRowSwipeEnd({ offset: 28, velocityX: 0, widths: both })).toBe("leading");
    expect(resolveRowSwipeEnd({ offset: 27, velocityX: 0, widths: both })).toBeNull();
  });

  it("往左甩：露得再少也打开右侧动作", () => {
    expect(resolveRowSwipeEnd({ offset: -20, velocityX: -ROW_SWIPE_FLING_PX_PER_MS, widths: both })).toBe("trailing");
  });

  it("往右甩：从右侧打开态甩回来是收起，不会越过去打开左侧", () => {
    expect(resolveRowSwipeEnd({ offset: -150, velocityX: ROW_SWIPE_FLING_PX_PER_MS, widths: both })).toBeNull();
    expect(resolveRowSwipeEnd({ offset: 10, velocityX: ROW_SWIPE_FLING_PX_PER_MS, widths: both })).toBe("leading");
  });

  it("往没有动作的一侧甩：收起", () => {
    expect(resolveRowSwipeEnd({ offset: 0, velocityX: ROW_SWIPE_FLING_PX_PER_MS, widths: trailingOnly })).toBeNull();
  });
});
