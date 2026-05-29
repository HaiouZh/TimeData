import { percentile } from "./baseline.js";
import { INSIGHT_CONSTANTS } from "./constants.js";
import type { InsightSession } from "./types.js";

export interface DepthThresholds {
  deepThresholdMin: number;
  fragmentThresholdMin: number;
}

export interface DepthMetrics {
  sessionCount: number;
  totalMin: number;
  medianSessionMin: number;
  deepBlockCount: number;
  deepMin: number;
  deepRatioPct: number;
  fragmentSessionCount: number;
  fragmentMin: number;
  fragmentRatioPct: number;
}

export interface FragmentMetrics {
  switchesPerActiveHour: number;
  shortSessionRatioPct: number;
  baselineSwitchesPerActiveHour: number;
  baselineShortSessionRatioPct: number;
}

export interface EntropyResult {
  entropyBits: number;
  maxBits: number;
  normalizedPct: number;
  parentCount: number;
}

export interface ImbalanceItem {
  parentId: string;
  currentSharePct: number;
  baselineMeanPct: number;
  baselineStdevPct: number;
  z: number;
  direction: "high" | "low";
  daysWithData: number;
}

export interface StructureOptions {
  deepSessionPercentile?: number;
  fragmentSessionPercentile?: number;
  deepBlockFloorMin?: number;
  imbalanceStdevK?: number;
  imbalanceMinDaysWithData?: number;
}

export interface StructureResult {
  excludedSleep: boolean;
  thresholds: DepthThresholds;
  current: DepthMetrics;
  baseline: DepthMetrics;
  fragment: FragmentMetrics;
  entropy: EntropyResult;
  imbalances: ImbalanceItem[];
  baselineDaysWithData: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function poolSessions(sessions: InsightSession[], sleepCategoryId: string | null): InsightSession[] {
  return sessions.filter(
    (s) =>
      s.durationMin >= INSIGHT_CONSTANTS.minSessionMin &&
      !(sleepCategoryId !== null && s.parentId === sleepCategoryId),
  );
}

export function computeDepthThresholds(baselineDurations: number[], options: StructureOptions = {}): DepthThresholds {
  const deepPct = options.deepSessionPercentile ?? INSIGHT_CONSTANTS.deepSessionPercentile;
  const fragPct = options.fragmentSessionPercentile ?? INSIGHT_CONSTANTS.fragmentSessionPercentile;
  const floor = options.deepBlockFloorMin ?? INSIGHT_CONSTANTS.deepBlockFloorMin;
  const p70 = percentile(baselineDurations, deepPct) ?? 0;
  const p30 = percentile(baselineDurations, fragPct) ?? 0;
  return { deepThresholdMin: r1(Math.max(p70, floor)), fragmentThresholdMin: r1(p30) };
}

export function computeDepthMetrics(pool: InsightSession[], thresholds: DepthThresholds): DepthMetrics {
  const durs = pool.map((s) => s.durationMin);
  const totalMin = durs.reduce((a, b) => a + b, 0);
  const deep = pool.filter((s) => s.durationMin >= thresholds.deepThresholdMin);
  const frag = pool.filter((s) => s.durationMin <= thresholds.fragmentThresholdMin);
  const deepMin = deep.reduce((a, b) => a + b.durationMin, 0);
  const fragMin = frag.reduce((a, b) => a + b.durationMin, 0);
  return {
    sessionCount: pool.length,
    totalMin: Math.round(totalMin),
    medianSessionMin: Math.round(percentile(durs, 0.5) ?? 0),
    deepBlockCount: deep.length,
    deepMin: Math.round(deepMin),
    deepRatioPct: totalMin > 0 ? r1((deepMin / totalMin) * 100) : 0,
    fragmentSessionCount: frag.length,
    fragmentMin: Math.round(fragMin),
    fragmentRatioPct: totalMin > 0 ? r1((fragMin / totalMin) * 100) : 0,
  };
}

// Task 3 会继续填充：碎片次级指标 / 熵 / 失衡。
