import { prefersReducedMotion } from "../lib/prefersReducedMotion.js";

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * 「回到最新」的滚动方案：先瞬移到 jumpTo（null = 不瞬移），再平滑滚到 smoothTo（null = 不平滑）。
 * 两者最多各一步，页面层照单执行，不再自己算像素。
 */
export interface ScrollToLatestPlan {
  jumpTo: number | null;
  smoothTo: number | null;
}

/**
 * 离底超过这么多屏时先瞬移、只把最后这几屏交给平滑滚动——Telegram Web-A `fastSmoothScroll` 同款。
 * 浏览器原生 smooth 的时长随距离增长，翻了几十屏再点「回到最新」会滚上一两秒；截成恒定两屏后，
 * 动画时长与起点无关，既保留「看着它滚过去」的空间感，又不拖。
 */
export const SMOOTH_RUN_SCREENS = 2;

export function planScrollToLatest(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  { reducedMotion }: { reducedMotion: boolean },
): ScrollToLatestPlan {
  const bottom = Math.max(0, scrollHeight - clientHeight);
  if (reducedMotion) return { jumpTo: bottom, smoothTo: null };
  const runway = SMOOTH_RUN_SCREENS * clientHeight;
  const distance = bottom - scrollTop;
  return { jumpTo: distance > runway ? bottom - runway : null, smoothTo: bottom };
}

/** 按方案滚动容器：瞬移一步（若有）+ 平滑一步（若有）。jsdom 没有 Element.scrollTo，退回直接赋值。 */
export function scrollToLatest(el: HTMLElement, reducedMotion: boolean = prefersReducedMotion()): void {
  const plan = planScrollToLatest(el, { reducedMotion });
  if (plan.jumpTo !== null) el.scrollTop = plan.jumpTo;
  if (plan.smoothTo === null) return;
  if (typeof el.scrollTo === "function") el.scrollTo({ top: plan.smoothTo, behavior: "smooth" });
  else el.scrollTop = plan.smoothTo;
}

/** 换数据窗口后列表整块淡入的时长；淡出/淡入 150ms 与日期条隐身同一节奏。 */
export const LIST_REVEAL_MS = 150;

/**
 * 「回到最新」跨数据窗口时，新列表落定那一刻整块淡入——换窗口本身是硬切（旧内容整批换成新内容，
 * 没有可滚的路径），淡入是唯一能给的过渡。走 Web Animations 直接作用在列表内层：不加 state、
 * 不重渲染、天然可重入（连点两次只是重新开始动画）。减弱动效时不做。
 */
export function revealList(el: Element | null, reducedMotion: boolean = prefersReducedMotion()): void {
  if (!el || reducedMotion || typeof el.animate !== "function") return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LIST_REVEAL_MS, easing: "ease-out" });
}
