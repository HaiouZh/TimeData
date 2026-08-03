import { describe, expect, it } from "vitest";
import {
  EDGE_SLOP_PX,
  EDGE_WIDTH_PX,
  resolveEdgeSwipeEnd,
  resolveEdgeSwipeIntent,
  shouldStartEdgeSwipe,
} from "./edgeSwipe.ts";

describe("shouldStartEdgeSwipe", () => {
  it("起点必须在最左边缘内", () => {
    expect(shouldStartEdgeSwipe({ startX: 5, dx: 12, dy: 2 })).toBe(true);
    expect(shouldStartEdgeSwipe({ startX: EDGE_WIDTH_PX + 1, dx: 12, dy: 2 })).toBe(false);
  });

  it("只认向右、且水平主导", () => {
    expect(shouldStartEdgeSwipe({ startX: 3, dx: -12, dy: 2 })).toBe(false);
    expect(shouldStartEdgeSwipe({ startX: 3, dx: 6, dy: 20 })).toBe(false);
  });

  it("边界：恰好 20px 起点算数", () => {
    expect(shouldStartEdgeSwipe({ startX: EDGE_WIDTH_PX, dx: 12, dy: 1 })).toBe(true);
  });
});

describe("resolveEdgeSwipeIntent", () => {
  it("位移没过 slop 一律 pending——此时既不判方向也不该拦事件", () => {
    // 真实反例：拇指贴左边缘往下滚列表，第一条 touchmove 就是这个形状。
    // 没有 pending 这一档它会被判成「水平主导」而锁死整笔手势，整页滚不动。
    expect(resolveEdgeSwipeIntent({ startX: 3, dx: 2, dy: 1 })).toBe("pending");
    expect(resolveEdgeSwipeIntent({ startX: 3, dx: EDGE_SLOP_PX - 1, dy: 0 })).toBe("pending");
  });

  it("过 slop 后横向主导才 engage", () => {
    expect(resolveEdgeSwipeIntent({ startX: 3, dx: EDGE_SLOP_PX, dy: 0 })).toBe("engage");
    expect(resolveEdgeSwipeIntent({ startX: 3, dx: 40, dy: 6 })).toBe("engage");
  });

  it("过 slop 后判成纵向 / 反向 / 非边缘一律 abandon", () => {
    expect(resolveEdgeSwipeIntent({ startX: 3, dx: 6, dy: 40 })).toBe("abandon");
    expect(resolveEdgeSwipeIntent({ startX: 3, dx: -40, dy: 2 })).toBe("abandon");
    expect(resolveEdgeSwipeIntent({ startX: EDGE_WIDTH_PX + 1, dx: 40, dy: 2 })).toBe("abandon");
  });
});

describe("resolveEdgeSwipeEnd", () => {
  it("位移过三分之一就完成", () => {
    expect(resolveEdgeSwipeEnd({ dx: 140, velocityX: 0, viewportWidth: 390 })).toBe("complete");
    expect(resolveEdgeSwipeEnd({ dx: 100, velocityX: 0, viewportWidth: 390 })).toBe("cancel");
  });

  it("位移不够但甩得快也完成", () => {
    expect(resolveEdgeSwipeEnd({ dx: 60, velocityX: 0.8, viewportWidth: 390 })).toBe("complete");
    expect(resolveEdgeSwipeEnd({ dx: 60, velocityX: 0.4, viewportWidth: 390 })).toBe("cancel");
  });
});
