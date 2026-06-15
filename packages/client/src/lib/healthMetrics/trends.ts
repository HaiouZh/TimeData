import type { HealthRun } from "@timedata/shared";
import { formatDecimalHours, formatPace, secondsPerKm } from "./format.js";
import { getChartSeries } from "./chartSeries.js";
import type {
  HealthMetricCollections,
  NormalizedHealthTrendPoint,
  RunPaceTrendPoint,
} from "./types.js";

type RunWithPaceData = HealthRun & { distanceKm: number; durationSeconds: number };

function hasRunPaceData(run: HealthRun): run is RunWithPaceData {
  return run.distanceKm != null && run.distanceKm > 0 && run.durationSeconds != null && run.durationSeconds > 0;
}

function compareRuns(a: RunWithPaceData, b: RunWithPaceData): number {
  return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id);
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

const TREND_METRIC_IDS = ["sleep.duration", "hrv.value", "stress.value", "heart_rate.resting"] as const;
const TREND_KEY_BY_ID: Record<string, keyof Omit<NormalizedHealthTrendPoint, "date">> = {
  "sleep.duration": "sleep",
  "hrv.value": "hrv",
  "stress.value": "stress",
  "heart_rate.resting": "heartRate",
};

function formatTrendValue(metricId: string, raw: number | null, formatted: string | null): string | null {
  if (raw == null || formatted === "--") return null;
  if (metricId === "sleep.duration") return formatDecimalHours(raw);
  return formatted;
}

export function buildNormalizedHealthTrend(input: HealthMetricCollections): NormalizedHealthTrendPoint[] {
  const result = getChartSeries(
    { metricIds: [...TREND_METRIC_IDS], rollingWindows: [], range: { mode: "all" } },
    input,
  );

  const seriesByKey = new Map<string, (typeof result.series)[number]>();
  for (const series of result.series) seriesByKey.set(series.metricId, series);

  const normalizedByKey = new Map<string, Array<number | null>>();
  for (const [metricId, series] of seriesByKey) {
    normalizedByKey.set(
      metricId,
      normalizeSeries(series.points.map((point) => point.value)),
    );
  }

  const dates = result.series[0]?.points.map((point) => point.date) ?? [];
  return dates.map((date, index) => {
    const point = { date } as NormalizedHealthTrendPoint;
    for (const metricId of TREND_METRIC_IDS) {
      const key = TREND_KEY_BY_ID[metricId];
      const series = seriesByKey.get(metricId);
      const raw = series?.points[index]?.value ?? null;
      const normalized = normalizedByKey.get(metricId)?.[index] ?? null;
      const formatted = series?.points[index]?.formattedValue ?? null;
      point[key] = { raw, normalized, formatted: formatTrendValue(metricId, raw, formatted) };
    }
    return point;
  });
}
