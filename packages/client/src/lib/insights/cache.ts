import type { Category, TimeEntry } from "@timedata/shared";
import { detectAnomalies, type DetectAnomaliesInput } from "./anomalies.js";
import { buildDailyRollups } from "./dailyRollup.js";
import { buildOverviewInsights, type OverviewInput } from "./overview.js";
import { buildRoutineInsights, type RoutineInput } from "./routine.js";
import { buildStructure, type BuildStructureInput } from "./structure.js";
import { buildTrend, type TrendResult, type TrendWindow } from "./trends.js";
import type { DailyRollup } from "./types.js";

// 廉价指纹：本仓写路径会 bump updatedAt；增删改都会改变数量或最大更新时间。
export function fingerprintEntries(entries: TimeEntry[]): string {
  let maxUpdated = "";
  for (const entry of entries) {
    if (entry.updatedAt > maxUpdated) maxUpdated = entry.updatedAt;
  }
  return `${entries.length}:${maxUpdated}`;
}

export function fingerprintCategories(categories: Category[]): string {
  let maxUpdated = "";
  for (const category of categories) {
    if (category.updatedAt > maxUpdated) maxUpdated = category.updatedAt;
  }
  return `${categories.length}:${maxUpdated}`;
}

// 单槽记忆化足够覆盖统计页当前视图，并能跨 React 卸载/重挂存活。
export function createInsightMemo<TIn, TOut>(
  fn: (input: TIn) => TOut,
  keyOf: (input: TIn) => string,
): (input: TIn) => TOut {
  let last: { key: string; out: TOut } | null = null;
  return (input) => {
    const key = keyOf(input);
    if (last?.key === key) return last.out;
    const out = fn(input);
    last = { key, out };
    return out;
  };
}

const rollupCache = new Map<string, { fp: string; value: DailyRollup[] }>();

export function getCachedDailyRollups(
  entries: TimeEntry[],
  categories: Category[],
  fromDate: string,
  toDate: string,
): DailyRollup[] {
  const key = `${fromDate}~${toDate}`;
  const fp = `${fingerprintEntries(entries)}|${fingerprintCategories(categories)}`;
  const cached = rollupCache.get(key);
  if (cached?.fp === fp) return cached.value;
  const value = buildDailyRollups(entries, categories, fromDate, toDate);
  rollupCache.set(key, { fp, value });
  return value;
}

const sleepKey = (id: string | null) => id ?? "none";

export const memoStructure = createInsightMemo<BuildStructureInput, ReturnType<typeof buildStructure>>(
  buildStructure,
  (input) =>
    `${input.periodFrom}~${input.periodTo}|${input.baselineFrom}~${input.baselineTo}|${sleepKey(input.sleepCategoryId)}` +
    `|period:${fingerprintEntries(input.periodEntries)}|baseline:${fingerprintEntries(input.baselineEntries)}` +
    `|categories:${fingerprintCategories(input.categories)}`,
);

export const memoRoutine = createInsightMemo<RoutineInput, ReturnType<typeof buildRoutineInsights>>(
  buildRoutineInsights,
  (input) =>
    `${input.fromDate}~${input.toDate}|${sleepKey(input.sleepCategoryId)}` +
    `|entries:${fingerprintEntries(input.entries)}|categories:${fingerprintCategories(input.categories)}`,
);

export const memoOverview = createInsightMemo<OverviewInput, ReturnType<typeof buildOverviewInsights>>(
  buildOverviewInsights,
  (input) =>
    `${input.fromDate}~${input.toDate}|${sleepKey(input.sleepCategoryId)}` +
    `|entries:${fingerprintEntries(input.entries)}|categories:${fingerprintCategories(input.categories)}`,
);

export const memoAnomalies = createInsightMemo<DetectAnomaliesInput, ReturnType<typeof detectAnomalies>>(
  detectAnomalies,
  (input) => {
    const sleepWindow = input.sleepWindow;
    const windowKey = sleepWindow
      ? `${sleepWindow.startMin}-${sleepWindow.endMin}-${sleepWindow.source}`
      : "default";
    return (
      `${input.fromDate}~${input.toDate}|${sleepKey(input.sleepCategoryId)}|sleepWindow:${windowKey}` +
      `|entries:${fingerprintEntries(input.entries)}|categories:${fingerprintCategories(input.categories)}`
    );
  },
);

let lastTrend: { key: string; out: TrendResult } | null = null;

export function memoTrend(entries: TimeEntry[], categories: Category[], window: TrendWindow): TrendResult {
  const key =
    `${window.prevFrom}~${window.prevTo}|${window.from}~${window.to}` +
    `|entries:${fingerprintEntries(entries)}|categories:${fingerprintCategories(categories)}`;
  if (lastTrend?.key === key) return lastTrend.out;
  const out = buildTrend(entries, categories, window, {});
  lastTrend = { key, out };
  return out;
}
