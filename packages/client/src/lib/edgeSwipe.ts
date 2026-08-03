/** 触点起始 x 在这个宽度内才算「从边缘起手」。 */
export const EDGE_WIDTH_PX = 20;
/** 位移过屏宽这个比例即判定返回。 */
export const COMPLETE_RATIO = 1 / 3;
/** 位移不够时的甩动阈值（px/ms）。iOS 手感常用档，真机微调只改这一个常量。 */
export const FLING_VELOCITY_PX_PER_MS = 0.5;

export function shouldStartEdgeSwipe({ startX, dx, dy }: { startX: number; dx: number; dy: number }): boolean {
  if (startX > EDGE_WIDTH_PX) return false;
  if (dx <= 0) return false;
  return Math.abs(dx) > Math.abs(dy);
}

export function resolveEdgeSwipeEnd({
  dx,
  velocityX,
  viewportWidth,
}: {
  dx: number;
  velocityX: number;
  viewportWidth: number;
}): "complete" | "cancel" {
  if (dx > viewportWidth * COMPLETE_RATIO) return "complete";
  if (velocityX > FLING_VELOCITY_PX_PER_MS) return "complete";
  return "cancel";
}
