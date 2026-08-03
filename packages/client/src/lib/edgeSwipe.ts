/** 触点起始 x 在这个宽度内才算「从边缘起手」。 */
export const EDGE_WIDTH_PX = 20;
/** 位移过屏宽这个比例即判定返回。 */
export const COMPLETE_RATIO = 1 / 3;
/** 位移不够时的甩动阈值（px/ms）。iOS 手感常用档，真机微调只改这一个常量。 */
export const FLING_VELOCITY_PX_PER_MS = 0.5;
/** 累计位移到这个距离才判方向。到不了就什么都不做——不锁手势、不拦事件。 */
export const EDGE_SLOP_PX = 10;

export function shouldStartEdgeSwipe({ startX, dx, dy }: { startX: number; dx: number; dy: number }): boolean {
  if (startX > EDGE_WIDTH_PX) return false;
  if (dx <= 0) return false;
  return Math.abs(dx) > Math.abs(dy);
}

/** 起手三态：还没到 slop / 接管这一笔 / 这一笔不归我们。 */
export type EdgeSwipeIntent = "pending" | "engage" | "abandon";

/**
 * 方向**只判一次**，且必须等位移过 slop 之后再判。
 *
 * 少了 `pending` 这一档就是这样一个真实故障：拇指贴左边缘往下滚列表，第一条 touchmove
 * 常常是 `dx=2, dy=1`——水平「主导」，于是当场锁定手势，此后每条 touchmove 都被 preventDefault，
 * 整笔滑动完全滚不动。判成纵向即 `abandon`，本笔手势彻底作废（之后再横滑也不接），
 * 否则用户中途拐个弯又会被抢走。
 */
export function resolveEdgeSwipeIntent({
  startX,
  dx,
  dy,
}: {
  startX: number;
  dx: number;
  dy: number;
}): EdgeSwipeIntent {
  if (Math.hypot(dx, dy) < EDGE_SLOP_PX) return "pending";
  return shouldStartEdgeSwipe({ startX, dx, dy }) ? "engage" : "abandon";
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
