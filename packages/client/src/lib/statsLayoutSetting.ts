import { useCallback, useMemo } from "react";
import type { StatsModuleDescriptor, StatsModuleId } from "../pages/stats/modules/types.ts";
import { getSetting, setSetting, useSetting } from "./settings/index.ts";

export const STATS_LAYOUT_KEY = "stats.layout.v1";

export interface StatsLayoutV1 {
  order: StatsModuleId[];
  hidden: StatsModuleId[];
}

export function DEFAULT_STATS_LAYOUT(modules: StatsModuleDescriptor[]): StatsLayoutV1 {
  return {
    order: modules.map((module) => module.id),
    hidden: modules.filter((module) => !module.defaultVisible).map((module) => module.id),
  };
}

function parseLayout(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function sanitizeStatsLayout(raw: unknown, modules: StatsModuleDescriptor[]): StatsLayoutV1 {
  if (modules.length === 0) return { order: [], hidden: [] };

  const parsed = raw && typeof raw === "object" ? (raw as { order?: unknown; hidden?: unknown }) : null;
  const rawOrder = Array.isArray(parsed?.order) ? parsed.order : [];
  const rawHidden = Array.isArray(parsed?.hidden) ? parsed.hidden : [];
  const knownIds = new Set(modules.map((module) => module.id));

  const order: StatsModuleId[] = [];
  const seen = new Set<StatsModuleId>();
  for (const rawId of rawOrder) {
    const id = rawId as StatsModuleId;
    if (!knownIds.has(id) || seen.has(id)) continue;
    order.push(id);
    seen.add(id);
  }

  const hidden = new Set<StatsModuleId>();
  for (const module of modules) {
    if (!seen.has(module.id)) {
      order.push(module.id);
      seen.add(module.id);
    }
    if (!module.defaultVisible) hidden.add(module.id);
  }

  if (order.length === 0) return DEFAULT_STATS_LAYOUT(modules);

  for (const rawId of rawHidden) {
    const id = rawId as StatsModuleId;
    if (seen.has(id)) hidden.add(id);
  }

  return { order, hidden: order.filter((id) => hidden.has(id)) };
}

export async function getStatsLayout(modules: StatsModuleDescriptor[]): Promise<StatsLayoutV1> {
  return sanitizeStatsLayout(parseLayout(await getSetting(STATS_LAYOUT_KEY)), modules);
}

export function setStatsLayout(layout: StatsLayoutV1): Promise<void> {
  return setSetting(STATS_LAYOUT_KEY, JSON.stringify(layout));
}

export interface UseStatsLayout {
  order: StatsModuleId[];
  hidden: Set<StatsModuleId>;
  visibleModulesInOrder: StatsModuleId[];
  setLayout: (layout: StatsLayoutV1) => void;
  reset: () => void;
}

export function useStatsLayout(modules: StatsModuleDescriptor[]): UseStatsLayout {
  const raw = useSetting(STATS_LAYOUT_KEY);
  const layout = useMemo(() => sanitizeStatsLayout(parseLayout(raw), modules), [raw, modules]);
  const hidden = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  const visibleModulesInOrder = useMemo(() => layout.order.filter((id) => !hidden.has(id)), [layout.order, hidden]);

  const setLayout = useCallback((next: StatsLayoutV1) => {
    void setStatsLayout(next);
  }, []);
  const reset = useCallback(() => {
    void setStatsLayout(DEFAULT_STATS_LAYOUT(modules));
  }, [modules]);

  return { order: layout.order, hidden, visibleModulesInOrder, setLayout, reset };
}
