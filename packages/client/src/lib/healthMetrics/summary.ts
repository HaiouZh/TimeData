import type { HealthRun } from "@timedata/shared";
import {
  computeSleepDurationHours,
  formatDecimalHours,
  formatDistanceKm,
  formatIntegerUnit,
  formatRunSummaryPace,
} from "./format.js";
import type { HealthMetricCollections, HealthMetricId, HealthSummaryItem, HealthSummaryResult } from "./types.js";

function compareByDateAndId<T extends { date: string; id: string }>(a: T, b: T): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

function compareRuns(a: HealthRun, b: HealthRun): number {
  return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id);
}

function pickLatest<T extends { date: string; id: string }>(records: readonly T[] | undefined): T | null {
  if (!records || records.length === 0) return null;
  return [...records].sort(compareByDateAndId).at(-1) ?? null;
}

function pickLatestRun(records: readonly HealthRun[] | undefined): HealthRun | null {
  const valid = (records ?? []).filter(
    (record) =>
      record.distanceKm != null &&
      record.distanceKm > 0 &&
      record.durationSeconds != null &&
      record.durationSeconds > 0,
  );
  if (valid.length === 0) return null;
  return [...valid].sort(compareRuns).at(-1) ?? null;
}

function createItem(
  id: HealthMetricId,
  label: string,
  value: number | null,
  formatted: string,
  date: string | null,
  secondaryFormatted?: string | null,
): HealthSummaryItem {
  return { id, label, value, formatted, date, secondaryFormatted };
}

export function buildHealthSummary(input: HealthMetricCollections): HealthSummaryResult {
  const sleep = pickLatest(input.sleeps);
  const hrv = pickLatest(input.hrvs);
  const stress = pickLatest(input.stresses);
  const heartRate = pickLatest(input.heartRates);
  const run = pickLatestRun(input.runs);

  const sleepHours = sleep ? computeSleepDurationHours(sleep) : null;
  const heartRateValue = heartRate ? (heartRate.restingHeartRate ?? heartRate.avgHeartRate ?? null) : null;
  const runDistance = run?.distanceKm ?? null;

  const items = [
    createItem("sleep", "睡眠", sleepHours, formatDecimalHours(sleepHours) ?? "--", sleep?.date ?? null),
    createItem(
      "hrv",
      "HRV",
      hrv?.hrvMs ?? null,
      formatIntegerUnit(hrv?.hrvMs ?? null, "ms") ?? "--",
      hrv?.date ?? null,
    ),
    createItem(
      "stress",
      "压力",
      stress?.stress ?? null,
      formatIntegerUnit(stress?.stress ?? null) ?? "--",
      stress?.date ?? null,
    ),
    createItem(
      "heartRate",
      "静息心率",
      heartRateValue,
      formatIntegerUnit(heartRateValue, "bpm") ?? "--",
      heartRate?.date ?? null,
    ),
    createItem(
      "run",
      "跑步",
      runDistance,
      formatDistanceKm(runDistance) ?? "--",
      run?.date ?? null,
      run ? formatRunSummaryPace(run.durationSeconds, run.distanceKm) : null,
    ),
  ];

  const byId = Object.fromEntries(items.map((item) => [item.id, item])) as Record<HealthMetricId, HealthSummaryItem>;
  return { items, byId };
}
