import { useMemo } from "react";
import {
  DESKTOP_NAV_DEFAULT_ITEMS,
  findMainNavItem,
  type DesktopNavItemConfig,
  type DesktopNavPlacement,
  type MainNavRoute,
} from "../navigation/navRegistry.js";
import { getSetting, setSetting, useSetting } from "./index.js";

export const DESKTOP_SIDEBAR_KEY = "nav.desktopSidebar.v1";

function defaultPlacementFor(route: MainNavRoute): DesktopNavPlacement {
  return findMainNavItem(route)?.defaultDesktopPlacement ?? "primary";
}

function normalizePlacement(value: unknown, route: MainNavRoute): DesktopNavPlacement {
  return value === "primary" || value === "more" ? value : defaultPlacementFor(route);
}

export function sanitizeDesktopSidebarConfig(value: unknown): DesktopNavItemConfig[] {
  if (!value || typeof value !== "object") return [...DESKTOP_NAV_DEFAULT_ITEMS];
  const items = Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : null;
  if (!items) return [...DESKTOP_NAV_DEFAULT_ITEMS];

  const seen = new Set<MainNavRoute>();
  const normalized: DesktopNavItemConfig[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const route = (item as { to?: unknown }).to;
    if (typeof route !== "string") continue;
    const navItem = findMainNavItem(route);
    if (!navItem || seen.has(navItem.to)) continue;
    seen.add(navItem.to);
    normalized.push({
      to: navItem.to,
      placement: normalizePlacement((item as { placement?: unknown }).placement, navItem.to),
    });
  }

  for (const fallback of DESKTOP_NAV_DEFAULT_ITEMS) {
    if (!seen.has(fallback.to)) normalized.push(fallback);
  }

  return normalized;
}

function parseDesktopSidebarConfig(raw: string | null): DesktopNavItemConfig[] {
  if (!raw) return [...DESKTOP_NAV_DEFAULT_ITEMS];
  try {
    return sanitizeDesktopSidebarConfig(JSON.parse(raw));
  } catch {
    return [...DESKTOP_NAV_DEFAULT_ITEMS];
  }
}

export async function readDesktopSidebarConfig(): Promise<DesktopNavItemConfig[]> {
  return parseDesktopSidebarConfig(await getSetting(DESKTOP_SIDEBAR_KEY));
}

export function setDesktopSidebarConfig(items: readonly DesktopNavItemConfig[]): Promise<void> {
  return setSetting(DESKTOP_SIDEBAR_KEY, JSON.stringify({ items: sanitizeDesktopSidebarConfig({ items }) }));
}

export function useDesktopSidebarConfig(): DesktopNavItemConfig[] {
  const raw = useSetting(DESKTOP_SIDEBAR_KEY);
  return useMemo(() => parseDesktopSidebarConfig(raw), [raw]);
}
