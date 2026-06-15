import type { HealthRun } from "@timedata/shared";
import {
  buildHealthSummary,
  computeSleepDurationHours,
  formatPace,
  secondsPerKm,
  type ChartSeriesRange,
  type HealthMetricCollections,
} from "../healthMetrics/index.js";

export type HealthSummaryTone = "sleep" | "hrv" | "heart" | "stress" | "run";

export interface HealthSummaryCardItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: HealthSummaryTone;
}

function isValidRun(run: HealthRun): run is HealthRun & { distanceKm: number; durationSeconds: number } {
  return (
    typeof run.distanceKm === "number" &&
    Number.isFinite(run.distanceKm) &&
    run.distanceKm > 0 &&
    typeof run.durationSeconds === "number" &&
    Number.isFinite(run.durationSeconds) &&
    run.durationSeconds > 0
  );
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatHours(value: number | null): string {
  return value == null ? "--" : `${value.toFixed(1)}h`;
}

function formatInteger(value: number | null, unit = ""): string {
  return value == null ? "--" : `${Math.round(value)}${unit}`;
}

function formatDistance(value: number | null): string {
  return value == null ? "--" : `${value.toFixed(1)}km`;
}

function formatPaceLabel(value: number | null): string {
  return value == null ? "--" : `${formatPace(value)}/km`;
}

function averageDetail(values: number[], formatter: (value: number | null) => string): string {
  const average = mean(values);
  return average == null ? "--" : formatter(average);
}

function summaryMetricMatches(itemId: string, metricId: string): boolean {
  if (itemId === "sleep") return metricId.startsWith("sleep.");
  if (itemId === "hrv") return metricId.startsWith("hrv.");
  if (itemId === "heartRate") return metricId.startsWith("heart_rate.");
  if (itemId === "stress") return metricId.startsWith("stress.");
  return metricId.startsWith("run.");
}

export function filterSummaryCardItems(items: HealthSummaryCardItem[], metricIds: readonly string[]): HealthSummaryCardItem[] {
  return items.filter((item) => metricIds.some((metricId) => summaryMetricMatches(item.id, metricId)));
}

export function buildHealthSummaryCardItems(
  collections: HealthMetricCollections,
  metricIds?: readonly string[],
): HealthSummaryCardItem[] {
  const summary = buildHealthSummary(collections);
  const sleepDurations = (collections.sleeps ?? []).map((row) => computeSleepDurationHours(row));
  const hrvValues = (collections.hrvs ?? []).map((row) => row.hrvMs);
  const stressValues = (collections.stresses ?? []).map((row) => row.stress);
  const heartRateValues = (collections.heartRates ?? [])
    .map((row) => row.restingHeartRate ?? row.avgHeartRate)
    .filter((value): value is number => value != null);
  const runs = collections.runs ?? [];
  const validRuns = runs.filter(isValidRun);
  const latestRuns = [...validRuns].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).slice(-5);
  const runDistance = validRuns.reduce((sum, run) => sum + run.distanceKm, 0);
  const runDuration = latestRuns.reduce((sum, run) => sum + run.durationSeconds, 0);
  const runDistanceForPace = latestRuns.reduce((sum, run) => sum + run.distanceKm, 0);
  const runAveragePace = secondsPerKm(runDuration, runDistanceForPace);

  const items: HealthSummaryCardItem[] = [
    {
      id: "sleep",
      label: summary.byId.sleep.label,
      value: formatHours(summary.byId.sleep.value),
      detail: `近7日均值 ${averageDetail(sleepDurations.slice(-7), formatHours)}`,
      tone: "sleep",
    },
    {
      id: "hrv",
      label: summary.byId.hrv.label,
      value: formatInteger(summary.byId.hrv.value, "ms"),
      detail: `近7日均值 ${averageDetail(hrvValues.slice(-7), (value) => formatInteger(value, "ms"))}`,
      tone: "hrv",
    },
    {
      id: "heartRate",
      label: summary.byId.heartRate.label,
      value: formatInteger(summary.byId.heartRate.value, "bpm"),
      detail: `近7日均值 ${averageDetail(heartRateValues.slice(-7), (value) => formatInteger(value, "bpm"))}`,
      tone: "heart",
    },
    {
      id: "stress",
      label: summary.byId.stress.label,
      value: formatInteger(summary.byId.stress.value),
      detail: `近7日均值 ${averageDetail(stressValues.slice(-7), (value) => formatInteger(value))}`,
      tone: "stress",
    },
    {
      id: "runs",
      label: summary.byId.run.label,
      value: `${runs.length}次`,
      detail: `总距离 ${formatDistance(runDistance)} · 最近 5 次均速 ${formatPaceLabel(runAveragePace)}`,
      tone: "run",
    },
  ];

  return metricIds ? filterSummaryCardItems(items, metricIds) : items;
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function allDates(collections: HealthMetricCollections): string[] {
  return [
    ...(collections.heartRates ?? []),
    ...(collections.hrvs ?? []),
    ...(collections.sleeps ?? []),
    ...(collections.stresses ?? []),
    ...(collections.runs ?? []),
  ].map((record) => record.date);
}

function filterRecords<T extends { date: string }>(records: readonly T[] | undefined, range: ChartSeriesRange, anchor: string | null): T[] {
  const rows = records ?? [];
  if (range.mode === "all") return [...rows];
  if (range.mode === "manual") return rows.filter((record) => record.date >= range.from && record.date <= range.to);
  if (anchor == null) return [];
  const from = addUtcDays(anchor, -(range.days - 1));
  return rows.filter((record) => record.date >= from && record.date <= anchor);
}

export function filterCollectionsByRange(collections: HealthMetricCollections, range: ChartSeriesRange): HealthMetricCollections {
  const dates = allDates(collections);
  const anchor = dates.length === 0 ? null : dates.sort()[dates.length - 1];
  return {
    heartRates: filterRecords(collections.heartRates, range, anchor),
    hrvs: filterRecords(collections.hrvs, range, anchor),
    sleeps: filterRecords(collections.sleeps, range, anchor),
    stresses: filterRecords(collections.stresses, range, anchor),
    runs: filterRecords(collections.runs, range, anchor),
  };
}
