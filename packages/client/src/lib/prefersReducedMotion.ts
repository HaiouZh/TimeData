/**
 * 用户是否开了系统级「减弱动态效果」。JS 驱动的动效（Web Animations / smooth 滚动 / 手势位移）
 * 不像 CSS transition 那样能靠媒体查询自动归零，各处调用前得自己问一声。
 */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
