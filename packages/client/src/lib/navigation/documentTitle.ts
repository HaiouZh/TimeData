import { findMainNavItem, primaryRouteForPath } from "./navRegistry.js";

/** 站点品牌名，作为所有页面标题的后缀，也是首页/未知页的兜底标题。 */
export const APP_BRAND = "TimeData";

const SEPARATOR = " · ";

/**
 * 把任意路径映射成浏览器标签/书签使用的标题。
 * 复用导航登记簿：先把深层路径归类到主路由，再取该主路由的中文 label。
 * 首页与未知路径只用品牌名，子页面用「分区名 · TimeData」。
 */
export function documentTitleForPath(pathname: string): string {
  const route = primaryRouteForPath(pathname);
  if (route === "/") return APP_BRAND;
  const item = findMainNavItem(route);
  if (!item) return APP_BRAND;
  return `${item.label}${SEPARATOR}${APP_BRAND}`;
}
