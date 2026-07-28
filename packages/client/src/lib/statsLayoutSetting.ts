import { useCallback, useMemo } from "react";
import type { StatsModuleId } from "../pages/stats/modules/types.ts";
import { getSetting, setSetting, useSetting } from "./settings/index.ts";

export const STATS_LAYOUT_KEY = "stats.layout.v1";

export interface ModuleDescriptorLike<Id extends string> {
  id: Id;
  defaultVisible: boolean;
}

export interface StatsLayoutV1Generic<Id extends string> {
  order: Id[];
  hidden: Id[];
}

// 保留原有类型别名,委托泛型版实现,行为不变。
export type StatsLayoutV1 = StatsLayoutV1Generic<StatsModuleId>;

export function DEFAULT_STATS_LAYOUT<Id extends string>(modules: ModuleDescriptorLike<Id>[]): StatsLayoutV1Generic<Id> {
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

export function sanitizeStatsLayout<Id extends string>(
  raw: unknown,
  modules: ModuleDescriptorLike<Id>[],
): StatsLayoutV1Generic<Id> {
  if (modules.length === 0) return { order: [], hidden: [] };

  const parsed = raw && typeof raw === "object" ? (raw as { order?: unknown; hidden?: unknown }) : null;
  const rawOrder = Array.isArray(parsed?.order) ? parsed.order : [];
  const rawHidden = Array.isArray(parsed?.hidden) ? parsed.hidden : [];
  const knownIds = new Set(modules.map((module) => module.id));

  const order: Id[] = [];
  const seen = new Set<Id>();
  for (const rawId of rawOrder) {
    const id = rawId as Id;
    if (!knownIds.has(id) || seen.has(id)) continue;
    order.push(id);
    seen.add(id);
  }

  const hidden = new Set<Id>();
  for (const module of modules) {
    if (!seen.has(module.id)) {
      order.push(module.id);
      seen.add(module.id);
    }
    if (!module.defaultVisible) hidden.add(module.id);
  }

  if (order.length === 0) return DEFAULT_STATS_LAYOUT(modules);

  for (const rawId of rawHidden) {
    const id = rawId as Id;
    if (seen.has(id)) hidden.add(id);
  }

  return { order, hidden: order.filter((id) => hidden.has(id)) };
}

export async function getStatsLayoutForKey<Id extends string>(
  key: string,
  modules: ModuleDescriptorLike<Id>[],
): Promise<StatsLayoutV1Generic<Id>> {
  return sanitizeStatsLayout(parseLayout(await getSetting(key)), modules);
}

export function setStatsLayoutForKey<Id extends string>(key: string, layout: StatsLayoutV1Generic<Id>): Promise<void> {
  return setSetting(key, JSON.stringify(layout));
}

export async function getStatsLayout(modules: ModuleDescriptorLike<StatsModuleId>[]): Promise<StatsLayoutV1> {
  return getStatsLayoutForKey(STATS_LAYOUT_KEY, modules);
}

export function setStatsLayout(layout: StatsLayoutV1): Promise<void> {
  return setStatsLayoutForKey(STATS_LAYOUT_KEY, layout);
}

export interface UseStatsLayoutGeneric<Id extends string> {
  order: Id[];
  hidden: Set<Id>;
  visibleModulesInOrder: Id[];
  setLayout: (layout: StatsLayoutV1Generic<Id>) => void;
  reset: () => void;
}

export type UseStatsLayout = UseStatsLayoutGeneric<StatsModuleId>;

export function useStatsLayoutForKey<Id extends string>(
  key: string,
  modules: ModuleDescriptorLike<Id>[],
): UseStatsLayoutGeneric<Id> {
  const raw = useSetting(key);
  const layout = useMemo(() => sanitizeStatsLayout(parseLayout(raw), modules), [raw, modules]);
  const hidden = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  const visibleModulesInOrder = useMemo(() => layout.order.filter((id) => !hidden.has(id)), [layout.order, hidden]);

  const setLayout = useCallback(
    (next: StatsLayoutV1Generic<Id>) => {
      void setStatsLayoutForKey(key, next);
    },
    [key],
  );
  const reset = useCallback(() => {
    void setStatsLayoutForKey(key, DEFAULT_STATS_LAYOUT(modules));
  }, [key, modules]);

  return { order: layout.order, hidden, visibleModulesInOrder, setLayout, reset };
}

export function useStatsLayout(modules: ModuleDescriptorLike<StatsModuleId>[]): UseStatsLayout {
  return useStatsLayoutForKey(STATS_LAYOUT_KEY, modules);
}
