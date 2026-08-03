import {
  Alarm,
  BookOpen,
  ChartLine,
  DotsThree,
  GearSix,
  ListChecks,
  NotePencil,
  Planet,
  Steps,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

export const MAIN_NAV_ROUTES = [
  "/quick-notes",
  "/diary",
  "/",
  "/todo",
  "/tracks",
  "/goals",
  "/stats/time",
  "/settings",
] as const;

export type MainNavRoute = (typeof MAIN_NAV_ROUTES)[number];

export type DesktopNavPlacement = "primary" | "more";

export interface MainNavItem {
  to: MainNavRoute;
  label: string;
  ariaLabel: string;
  icon: PhosphorIcon;
  iconName: string;
  defaultDesktopPlacement: DesktopNavPlacement;
}

export interface DesktopNavItemConfig {
  to: MainNavRoute;
  placement: DesktopNavPlacement;
}

export const MORE_NAV_ITEM = {
  label: "更多",
  ariaLabel: "更多导航",
  icon: DotsThree,
  iconName: "DotsThree",
} as const;

export const MAIN_NAV_ITEMS: readonly MainNavItem[] = [
  {
    to: "/quick-notes",
    label: "记录",
    ariaLabel: "记录",
    icon: NotePencil,
    iconName: "NotePencil",
    defaultDesktopPlacement: "primary",
  },
  {
    to: "/diary",
    label: "日记",
    ariaLabel: "日记",
    icon: BookOpen,
    iconName: "BookOpen",
    defaultDesktopPlacement: "primary",
  },
  {
    to: "/",
    label: "时间轴",
    ariaLabel: "时间轴",
    icon: Alarm,
    iconName: "Alarm",
    defaultDesktopPlacement: "primary",
  },
  {
    to: "/todo",
    label: "待办",
    ariaLabel: "待办",
    icon: ListChecks,
    iconName: "ListChecks",
    defaultDesktopPlacement: "primary",
  },
  {
    to: "/tracks",
    label: "轨道",
    ariaLabel: "轨道",
    icon: Steps,
    iconName: "Steps",
    defaultDesktopPlacement: "primary",
  },
  {
    to: "/goals",
    label: "目标",
    ariaLabel: "目标",
    icon: Planet,
    iconName: "Planet",
    defaultDesktopPlacement: "primary",
  },
  {
    to: "/stats/time",
    label: "时间",
    ariaLabel: "时间统计",
    icon: ChartLine,
    iconName: "ChartLine",
    defaultDesktopPlacement: "primary",
  },
  {
    to: "/settings",
    label: "设置",
    ariaLabel: "设置",
    icon: GearSix,
    iconName: "GearSix",
    defaultDesktopPlacement: "primary",
  },
];

const routeSet = new Set<string>(MAIN_NAV_ROUTES);

export const DESKTOP_NAV_DEFAULT_ITEMS: DesktopNavItemConfig[] = MAIN_NAV_ITEMS.map((item) => ({
  to: item.to,
  placement: item.defaultDesktopPlacement,
}));

export function isMainNavRoute(value: string): value is MainNavRoute {
  return routeSet.has(value);
}

export function findMainNavItem(route: string): MainNavItem | undefined {
  return MAIN_NAV_ITEMS.find((item) => item.to === route);
}

export function primaryRouteForPath(pathname: string): MainNavRoute {
  if (pathname === "/stats") return "/stats/time";
  if (pathname === "/" || pathname.startsWith("/entries/")) return "/";
  if (pathname === "/quick-notes") return "/quick-notes";
  if (pathname === "/diary" || pathname.startsWith("/diary/")) return "/diary";
  if (pathname === "/todo") return "/todo";
  if (pathname === "/tracks" || pathname.startsWith("/tracks/")) return "/tracks";
  if (pathname === "/goals" || pathname.startsWith("/goals/")) return "/goals";
  if (pathname === "/stats/time") return "/stats/time";
  if (pathname === "/stats/todo") return "/stats/time"; // 待办统计从「时间」入口进,高亮归它
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "/settings";
  return "/";
}

/**
 * 这条路由的布局是否**自己不要底栏**（钻进去的子页：记录编辑、设置二级、目标 / 轨道详情）。
 *
 * 两条渲染路径共用同一份判据：非 iOS 走 `App.tsx` 的单层壳，iOS 走 `KeptRouteStack` 的分层壳。
 * 曾经两边各抄一份，分头演化就会让两个平台静默分叉——一边子页干干净净，另一边底下多出一条底栏
 * 压着内容，且没有任何测试会红。故收到这张导航登记簿里，改一处两边同时生效。
 */
export function layoutHidesBottomNav(pathname: string): boolean {
  return (
    pathname.startsWith("/entries/") ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/goals/") ||
    pathname.startsWith("/tracks/")
  );
}
