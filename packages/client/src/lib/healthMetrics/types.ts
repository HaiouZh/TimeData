import type { HealthHeartRate, HealthHrv, HealthRun, HealthSleep, HealthStress } from "@timedata/shared";

export type MetricValueType = "number" | "time" | "pace";

export type HealthMetricRange = "30" | "90" | "all";

export type HealthMetricId = "sleep" | "hrv" | "stress" | "heartRate" | "run";
export type HealthTrendMetricId = Exclude<HealthMetricId, "run">;

export interface HealthMetricCollections {
  sleeps?: readonly HealthSleep[];
  hrvs?: readonly HealthHrv[];
  stresses?: readonly HealthStress[];
  heartRates?: readonly HealthHeartRate[];
  runs?: readonly HealthRun[];
}

export interface HealthSummaryItem {
  id: HealthMetricId;
  label: string;
  value: number | null;
  formatted: string;
  date: string | null;
  secondaryFormatted?: string | null;
}

export interface HealthSummaryResult {
  items: HealthSummaryItem[];
  byId: Record<HealthMetricId, HealthSummaryItem>;
}

export interface NormalizedMetricPoint {
  normalized: number | null;
  raw: number | null;
  formatted: string | null;
}

export interface NormalizedHealthTrendPoint {
  date: string;
  sleep: NormalizedMetricPoint;
  hrv: NormalizedMetricPoint;
  stress: NormalizedMetricPoint;
  heartRate: NormalizedMetricPoint;
}

export interface RunPaceTrendPoint {
  id: string;
  date: string;
  startTime: string;
  distanceKm: number;
  durationSeconds: number;
  paceSecondsPerKm: number | null;
  paceFormatted: string;
  rolling3SecondsPerKm: number | null;
  rolling3Formatted: string;
  rolling5SecondsPerKm: number | null;
  rolling5Formatted: string;
  rolling10SecondsPerKm: number | null;
  rolling10Formatted: string;
}

export type ChartSeriesRange =
  | { mode: "all" }
  | { mode: "recent"; days: number }
  | { mode: "manual"; from: string; to: string };

export interface GetChartSeriesOptions {
  metricIds: string[];
  rollingWindows: number[];
  range: ChartSeriesRange;
  clampToDataStart?: boolean;
}

export interface MetricPoint {
  date: string;
  value: number | null;
  formattedValue: string;
  rolling: Record<string, number | null>;
  formattedRolling: Record<string, string>;
}

export interface MetricSeries {
  metricId: string;
  label: string;
  unit: string;
  valueType: MetricValueType;
  points: MetricPoint[];
}

export interface ChartSeriesResult {
  from: string;
  to: string;
  series: MetricSeries[];
}
