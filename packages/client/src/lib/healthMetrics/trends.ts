import type { HealthHeartRate, HealthHrv, HealthRun, HealthStress } from "@timedata/shared";
import {
  computeSleepDurationHours,
  formatDecimalHours,
  formatIntegerUnit,
  formatPace,
  secondsPerKm,
} from "./format.js";
import type {
  HealthMetricCollections,
  NormalizedHealthTrendPoint,
  NormalizedMetricPoint,
  RunPaceTrendPoint,
} from "./types.js";

type RunWithPaceData = HealthRun & { distanceKm: number; durationSeconds: number };

function hasRunPaceData(run: HealthRun): run is RunWithPaceData {
  return run.distanceKm != null && run.distanceKm > 0 && run.durationSeconds != null && run.durationSeconds > 0;
}

function compareDates(a: { date: string; id: string }, b: { date: string; id: string }): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

function compareRuns(a: RunWithPaceData, b: RunWithPaceData): number {
  return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id);
}

function valuePoint(raw: number | null, normalized: number | null, formatted: string | null): NormalizedMetricPoint {
  return { raw, normalized, formatted };
}

function normalizeSeries(values: Array<number | null>): Array<number | null> {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) return values.map(() => null);
  if (present.length === 1) return values.map((value) => (value == null ? null : 50));
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (min === max) return values.map((value) => (value == null ? null : 50));
  return values.map((value) => {
    if (value == null) return null;
    return Math.round(((value - min) / (max - min)) * 100);
  });
}

function latestValueByDate<T extends { date: string; id: string }>(
  records: readonly T[] | undefined,
  project: (record: T) => number | null,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const record of [...(records ?? [])].sort(compareDates)) {
    map.set(record.date, project(record));
  }
  return map;
}

function formatMetricValue(metric: "sleep" | "hrv" | "stress" | "heartRate", raw: number | null): string | null {
  if (raw == null) return null;
  if (metric === "sleep") return formatDecimalHours(raw);
  if (metric === "hrv") return formatIntegerUnit(raw, "ms");
  if (metric === "stress") return formatIntegerUnit(raw);
  return formatIntegerUnit(raw, "bpm");
}

function uniqueSortedDates(input: HealthMetricCollections): string[] {
  const dates = new Set<string>();
  for (const record of input.sleeps ?? []) dates.add(record.date);
  for (const record of input.hrvs ?? []) dates.add(record.date);
  for (const record of input.stresses ?? []) dates.add(record.date);
  for (const record of input.heartRates ?? []) dates.add(record.date);
  return [...dates].sort();
}

function rollingPace(records: readonly RunWithPaceData[], endIndex: number, windowSize: number): number | null {
  const window = records.slice(Math.max(0, endIndex - windowSize + 1), endIndex + 1);
  const totalDistance = window.reduce((sum, record) => sum + record.distanceKm, 0);
  const totalDuration = window.reduce((sum, record) => sum + record.durationSeconds, 0);
  return secondsPerKm(totalDuration, totalDistance);
}

export function buildRunPaceTrend(runs: readonly HealthRun[]): RunPaceTrendPoint[] {
  const sorted = [...runs].filter(hasRunPaceData).sort(compareRuns);

  return sorted.map((run, index) => {
    const pace = secondsPerKm(run.durationSeconds, run.distanceKm);
    const rolling3 = rollingPace(sorted, index, 3);
    const rolling5 = rollingPace(sorted, index, 5);
    const rolling10 = rollingPace(sorted, index, 10);
    return {
      id: run.id,
      date: run.date,
      startTime: run.startTime,
      distanceKm: run.distanceKm,
      durationSeconds: run.durationSeconds,
      paceSecondsPerKm: pace,
      paceFormatted: formatPace(pace),
      rolling3SecondsPerKm: rolling3,
      rolling3Formatted: formatPace(rolling3),
      rolling5SecondsPerKm: rolling5,
      rolling5Formatted: formatPace(rolling5),
      rolling10SecondsPerKm: rolling10,
      rolling10Formatted: formatPace(rolling10),
    };
  });
}

export function buildNormalizedHealthTrend(input: HealthMetricCollections): NormalizedHealthTrendPoint[] {
  const dates = uniqueSortedDates(input);
  const sleepByDate = latestValueByDate(input.sleeps, computeSleepDurationHours);
  const hrvByDate = latestValueByDate(input.hrvs, (record: HealthHrv) => record.hrvMs);
  const stressByDate = latestValueByDate(input.stresses, (record: HealthStress) => record.stress);
  const heartRateByDate = latestValueByDate(
    input.heartRates,
    (record: HealthHeartRate) => record.restingHeartRate ?? record.avgHeartRate ?? null,
  );

  const sleepValues = normalizeSeries(dates.map((date) => sleepByDate.get(date) ?? null));
  const hrvValues = normalizeSeries(dates.map((date) => hrvByDate.get(date) ?? null));
  const stressValues = normalizeSeries(dates.map((date) => stressByDate.get(date) ?? null));
  const heartRateValues = normalizeSeries(dates.map((date) => heartRateByDate.get(date) ?? null));

  return dates.map((date, index) => {
    const sleepRaw = sleepByDate.get(date) ?? null;
    const hrvRaw = hrvByDate.get(date) ?? null;
    const stressRaw = stressByDate.get(date) ?? null;
    const heartRateRaw = heartRateByDate.get(date) ?? null;
    return {
      date,
      sleep: valuePoint(sleepRaw, sleepValues[index], formatMetricValue("sleep", sleepRaw)),
      hrv: valuePoint(hrvRaw, hrvValues[index], formatMetricValue("hrv", hrvRaw)),
      stress: valuePoint(stressRaw, stressValues[index], formatMetricValue("stress", stressRaw)),
      heartRate: valuePoint(heartRateRaw, heartRateValues[index], formatMetricValue("heartRate", heartRateRaw)),
    };
  });
}
