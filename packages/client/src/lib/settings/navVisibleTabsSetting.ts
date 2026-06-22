import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

export const NAV_VISIBLE_TABS_KEY = "nav.visibleTabs.v1";
export const CONFIGURABLE_TABS = ["/quick-notes", "/", "/todo", "/tracks", "/goals", "/stats/time", "/stats/health"] as const;

export type ConfigurableTab = (typeof CONFIGURABLE_TABS)[number];

function normalizeTab(value: string): ConfigurableTab | null {
  if (value === "/stats") return "/stats/time";
  return (CONFIGURABLE_TABS as readonly string[]).includes(value) ? (value as ConfigurableTab) : null;
}

export function sanitizeVisibleTabs(values: unknown): ConfigurableTab[] {
  if (!Array.isArray(values)) return [...CONFIGURABLE_TABS];

  const seen = new Set<ConfigurableTab>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = normalizeTab(value);
    if (normalized) seen.add(normalized);
  }

  return CONFIGURABLE_TABS.filter((tab) => seen.has(tab));
}

function parseVisibleTabs(raw: string | null): ConfigurableTab[] {
  if (!raw) return [...CONFIGURABLE_TABS];
  try {
    return sanitizeVisibleTabs(JSON.parse(raw));
  } catch {
    return [...CONFIGURABLE_TABS];
  }
}

export async function readVisibleTabs(): Promise<ConfigurableTab[]> {
  return parseVisibleTabs(await getSetting(NAV_VISIBLE_TABS_KEY));
}

export function setVisibleTabs(tabs: readonly string[]): Promise<void> {
  return setSetting(NAV_VISIBLE_TABS_KEY, JSON.stringify(sanitizeVisibleTabs([...tabs])));
}

export function useVisibleTabs(): ConfigurableTab[] {
  const raw = useSetting(NAV_VISIBLE_TABS_KEY);
  return useMemo(() => parseVisibleTabs(raw), [raw]);
}
