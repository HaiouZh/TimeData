import {
  Alarm,
  ChartLine,
  DotsThree,
  GearSix,
  Heartbeat,
  ListChecks,
  Notebook,
  Planet,
  Steps,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

export const MAIN_NAV_ROUTES = [
  "/quick-notes",
  "/",
  "/todo",
  "/tracks",
  "/goals",
  "/stats/time",
  "/stats/health",
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
    icon: Notebook,
    iconName: "Notebook",
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
    to: "/stats/health",
    label: "健康",
    ariaLabel: "健康统计",
    icon: Heartbeat,
    iconName: "Heartbeat",
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
  if (pathname === "/todo") return "/todo";
  if (pathname === "/tracks" || pathname.startsWith("/tracks/")) return "/tracks";
  if (pathname === "/goals" || pathname.startsWith("/goals/")) return "/goals";
  if (pathname === "/stats/time") return "/stats/time";
  if (pathname === "/stats/health") return "/stats/health";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "/settings";
  return "/";
}
