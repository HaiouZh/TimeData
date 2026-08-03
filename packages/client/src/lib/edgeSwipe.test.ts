import { describe, expect, it } from "vitest";
import { EDGE_WIDTH_PX, resolveEdgeSwipeEnd, shouldStartEdgeSwipe } from "./edgeSwipe.ts";

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
