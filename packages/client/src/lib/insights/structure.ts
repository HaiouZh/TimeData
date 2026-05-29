import { localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import { percentile } from "./baseline.js";
import { INSIGHT_CONSTANTS } from "./constants.js";
import type { DailyRollup, InsightSession } from "./types.js";

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

const toMs = (iso: string) => new Date(iso).getTime();
const r2 = (x: number) => Math.round(x * 100) / 100;
const MS_PER_DAY = 86400000;

function nextLocalHourBoundaryMs(rollupDate: string, currentHour: number): number {
  if (currentHour < 23) {
    return toMs(localDateTimeToUtc(`${rollupDate}T${String(currentHour + 1).padStart(2, "0")}:00:00`));
  }
  return toMs(localDateTimeToUtc(`${rollupDate}T00:00:00`)) + MS_PER_DAY;
}

function addActiveHourBuckets(activeHours: Set<string>, rollupDate: string, startMs: number, endMs: number): void {
  let cursor = startMs;
  while (cursor < endMs) {
    const hour = Number(utcToLocalDateTime(new Date(cursor).toISOString()).slice(11, 13));
    activeHours.add(`${rollupDate}#${hour}`);
    const nextHourStart = nextLocalHourBoundaryMs(rollupDate, hour);
    cursor = nextHourStart > cursor ? Math.min(nextHourStart, endMs) : endMs;
  }
}

export function switchesPerActiveHour(rollups: DailyRollup[], sleepCategoryId: string | null): number {
  let switches = 0;
  const activeHours = new Set<string>();
  for (const rollup of rollups) {
    const segs = rollup.segments.filter((s) => !(sleepCategoryId !== null && s.parentId === sleepCategoryId));
    for (let i = 1; i < segs.length; i++) if (segs[i].parentId !== segs[i - 1].parentId) switches++;
    for (const seg of segs) addActiveHourBuckets(activeHours, rollup.date, toMs(seg.start), toMs(seg.end));
  }
  return activeHours.size > 0 ? r2(switches / activeHours.size) : 0;
}

export function computeEntropy(byParent: Record<string, number>): EntropyResult {
  const vals = Object.values(byParent).filter((v) => v > 0);
  const total = vals.reduce((a, b) => a + b, 0);
  if (total === 0) return { entropyBits: 0, maxBits: 0, normalizedPct: 0, parentCount: 0 };
  let h = 0;
  for (const v of vals) {
    const p = v / total;
    h -= p * Math.log2(p);
  }
  const maxBits = vals.length > 1 ? Math.log2(vals.length) : 0;
  return {
    entropyBits: r2(h),
    maxBits: r2(maxBits),
    normalizedPct: maxBits > 0 ? r1((h / maxBits) * 100) : 0,
    parentCount: vals.length,
  };
}

export function computeImbalance(
  currentByParent: Record<string, number>,
  baselineRollups: DailyRollup[],
  options: StructureOptions = {},
): ImbalanceItem[] {
  const k = options.imbalanceStdevK ?? INSIGHT_CONSTANTS.imbalanceStdevK;
  const minDays = options.imbalanceMinDaysWithData ?? INSIGHT_CONSTANTS.imbalanceMinDaysWithData;

  const series = new Map<string, number[]>();
  for (const rollup of baselineRollups) {
    if (rollup.totalMin <= 0) continue;
    for (const [parentId, min] of Object.entries(rollup.byParent)) {
      const arr = series.get(parentId) ?? [];
      arr.push(min / rollup.totalMin);
      series.set(parentId, arr);
    }
  }

  const currentTotal = Object.values(currentByParent).reduce((a, b) => a + b, 0);
  if (currentTotal <= 0) return [];

  const items: ImbalanceItem[] = [];
  for (const [parentId, shares] of series) {
    if (shares.length < minDays) continue;
    const mu = shares.reduce((a, b) => a + b, 0) / shares.length;
    const variance = shares.reduce((s, x) => s + (x - mu) ** 2, 0) / (shares.length - 1);
    const sigma = Math.sqrt(variance);
    if (sigma <= 0) continue;
    const currentShare = (currentByParent[parentId] ?? 0) / currentTotal;
    const z = (currentShare - mu) / sigma;
    if (Math.abs(z) < k) continue;
    items.push({
      parentId,
      currentSharePct: r1(currentShare * 100),
      baselineMeanPct: r1(mu * 100),
      baselineStdevPct: r1(sigma * 100),
      z: r2(z),
      direction: z > 0 ? "high" : "low",
      daysWithData: shares.length,
    });
  }
  return items.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}
