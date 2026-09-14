/**
 * 列表行左右滑出动作条的手势算术。组件只负责喂坐标、写 transform；判定全在这里。
 * 手感参数集中在下面几个常量，真机微调只改它们。
 */

/** 单个动作按钮宽度（px）。按钮等宽、只放图标，宽度不随拖动距离挤压。 */
export const ROW_SWIPE_ACTION_WIDTH_PX = 56;
/** 累计位移到这个距离才判方向。到不了就什么都不做——不锁手势、不拦事件。 */
export const ROW_SWIPE_SLOP_PX = 10;
/**
 * 按下后停这么久才开始移动 = 长按起手，不接滑动。拖柄的 TouchSensor 是 300ms 按住激活，
 * 这条线必须比它短：否则激活后的横向拖动会被这里同时接走，行一边被拖一边往外滑。
 */
export const ROW_SWIPE_LONG_PRESS_MS = 250;
/** 露出动作条宽度的这个比例以上，松手停在打开态。 */
export const ROW_SWIPE_OPEN_RATIO = 0.5;
/** 甩动阈值（px/ms）。位置不够时按速度方向决定开 / 收。 */
export const ROW_SWIPE_FLING_PX_PER_MS = 0.3;
/** 最后一次移动距松手超过这么久，速度作废——拖到位停住再松手不算甩。 */
export const ROW_SWIPE_VELOCITY_STALE_MS = 80;
/** 越过动作条宽度后的跟手比例：越拉越紧，不硬卡。 */
export const ROW_SWIPE_OVERSHOOT_RESISTANCE = 0.3;
/** 松手后归位的时长与曲线（ease-out，头快尾稳）。 */
export const ROW_SWIPE_SETTLE_MS = 240;
export const ROW_SWIPE_SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** leading = 左侧动作（向右滑露出），trailing = 右侧动作（向左滑露出）。 */
export type RowSwipeSide = "leading" | "trailing";
/** 停靠态：打开哪一侧，null = 关闭。 */
export type RowSwipeRest = RowSwipeSide | null;

/** 两侧动作条的总宽（px）。某侧没有动作即为 0。 */
export interface RowSwipeWidths {
  leading: number;
  trailing: number;
}

export function rowSwipeRestOffset(rest: RowSwipeRest, widths: RowSwipeWidths): number {
  if (rest === "leading") return widths.leading;
  if (rest === "trailing") return -widths.trailing;
  return 0;
}

/** 起手三态：还没到 slop / 接管这一笔 / 这一笔不归我们。 */
export type RowSwipeIntent = "pending" | "engage" | "abandon";

/**
 * 方向只判一次，且必须等位移过 slop 之后再判——第一条 touchmove 常是 `dx=2, dy=1` 这种形状，
 * 当场判「横向主导」就会锁死竖滑（理由同 `edgeSwipe.ts` 的 pending 档）。
 */
export function resolveRowSwipeIntent({
  dx,
  dy,
  heldMs,
  rest,
  widths,
}: {
  dx: number;
  dy: number;
  /** 按下到本次移动的时长。 */
  heldMs: number;
  rest: RowSwipeRest;
  widths: RowSwipeWidths;
}): RowSwipeIntent {
  if (Math.hypot(dx, dy) < ROW_SWIPE_SLOP_PX) return "pending";
  if (Math.abs(dx) <= Math.abs(dy)) return "abandon";
  if (heldMs >= ROW_SWIPE_LONG_PRESS_MS) return "abandon";
  // 关闭态朝没有动作的一侧滑：不接，行纹丝不动。已打开时任意横滑都接（往回滑就是在收起）。
  if (rest === null && (dx > 0 ? widths.leading : widths.trailing) === 0) return "abandon";
  return "engage";
}

/** 手指位置换算成行的位移：动作条宽度以内 1:1，越界部分乘阻力；没有动作的一侧恒为 0。 */
export function rowSwipeDragOffset(raw: number, widths: RowSwipeWidths): number {
  if (raw > 0) {
    if (widths.leading === 0) return 0;
    return raw <= widths.leading ? raw : widths.leading + (raw - widths.leading) * ROW_SWIPE_OVERSHOOT_RESISTANCE;
  }
  if (raw < 0) {
    if (widths.trailing === 0) return 0;
    return raw >= -widths.trailing ? raw : -widths.trailing + (raw + widths.trailing) * ROW_SWIPE_OVERSHOOT_RESISTANCE;
  }
  return 0;
}

export function releaseVelocity({ velocityX, idleMs }: { velocityX: number; idleMs: number }): number {
  return idleMs > ROW_SWIPE_VELOCITY_STALE_MS ? 0 : velocityX;
}

/**
 * 松手停在哪。先看甩动方向，再看位置：
 * 从一侧打开态朝反方向甩是「收起」，不会一甩越过零点打开另一侧。
 */
export function resolveRowSwipeEnd({
  offset,
  velocityX,
  widths,
}: {
  offset: number;
  velocityX: number;
  widths: RowSwipeWidths;
}): RowSwipeRest {
  if (velocityX <= -ROW_SWIPE_FLING_PX_PER_MS) {
    if (offset > 0) return null;
    return widths.trailing > 0 ? "trailing" : null;
  }
  if (velocityX >= ROW_SWIPE_FLING_PX_PER_MS) {
    if (offset < 0) return null;
    return widths.leading > 0 ? "leading" : null;
  }
  if (widths.trailing > 0 && offset <= -widths.trailing * ROW_SWIPE_OPEN_RATIO) return "trailing";
  if (widths.leading > 0 && offset >= widths.leading * ROW_SWIPE_OPEN_RATIO) return "leading";
  return null;
}
