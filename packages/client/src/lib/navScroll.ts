/**
 * 底部导航「滚动隐藏」的纯判定逻辑。
 *
 * 设计意图（带滞回，避免微小抖动反复翻转）：
 * - 接近顶部恒显示；
 * - 向下累计位移超过 HIDE 阈值才隐藏（难藏）；
 * - 向上累计位移超过 SHOW 阈值即恢复（易出）；
 * - 方向反转时把累计器重置为当次位移，单次反向小动作不会误触发。
 */
export const NAV_SCROLL_NEAR_TOP_PX = 24;
export const NAV_SCROLL_HIDE_THRESHOLD_PX = 32;
export const NAV_SCROLL_SHOW_THRESHOLD_PX = 12;

export interface NavScrollState {
  lastScrollTop: number;
  /** 当前方向上的累计位移：向下为正、向上为负；方向反转时重置。 */
  accum: number;
  hidden: boolean;
}

/**
 * 重置累计器。`lastScrollTop` 应当用当前滚动位置作种子（路由切换 / 挂载时），
 * 否则首个滚动事件会被算成一次从 0 起的巨大位移。
 */
export function initialNavScrollState(lastScrollTop = 0, hidden = false): NavScrollState {
  return { lastScrollTop, accum: 0, hidden };
}

export function resolveNavVisibility(prev: NavScrollState, scrollTop: number): NavScrollState {
  if (scrollTop <= NAV_SCROLL_NEAR_TOP_PX) {
    return { lastScrollTop: scrollTop, accum: 0, hidden: false };
  }

  const delta = scrollTop - prev.lastScrollTop;
  if (delta === 0) {
    return { ...prev, lastScrollTop: scrollTop };
  }

  const sameDirection = prev.accum === 0 || (delta > 0) === (prev.accum > 0);
  const accum = sameDirection ? prev.accum + delta : delta;

  let hidden = prev.hidden;
  if (accum >= NAV_SCROLL_HIDE_THRESHOLD_PX) {
    hidden = true;
  } else if (accum <= -NAV_SCROLL_SHOW_THRESHOLD_PX) {
    hidden = false;
  }

  return { lastScrollTop: scrollTop, accum, hidden };
}
