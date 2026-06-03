import type { StatsModuleProps } from "./types.ts";

export function makeStatsProps(overrides: Partial<StatsModuleProps> = {}): StatsModuleProps {
  return {
    mode: "week",
    today: "2026-06-03",
    effectiveRange: {
      fromDate: "2026-05-28",
      toDate: "2026-06-03",
      startUtc: "2026-05-27T16:00:00.000Z",
      endUtc: "2026-06-03T16:00:00.000Z",
    },
    baselineFrom: "2026-05-05",
    entries: [],
    baselineEntries: [],
    categories: [],
    parentCategories: [],
    parentNameById: new Map(),
    sleepCategoryId: null,
    ...overrides,
  };
}
