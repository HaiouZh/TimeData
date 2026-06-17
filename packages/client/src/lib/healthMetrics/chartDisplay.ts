import type { MetricSeries } from "./types.js";

export type ChartRow = Record<string, number | string | null>;

export interface ChartRowsResult {
  dates: string[];
  rows: ChartRow[];
}

export function rollingKey(metricId: string, window: number): string {
  return `${metricId}:rolling:${window}`;
}

export type ChartMode = "raw-single" | "dual-axis" | "index";

export interface ChartLayout {
  mode: ChartMode;
  axisOf: (metricId: string) => "y" | "y1";
  transformOf: (metricId: string) => (value: number | null) => number | null;
}

const identity = (value: number | null): number | null => value;

function comparabilityKey(series: MetricSeries): string {
  if (series.valueType === "pace") return "pace";
  if (series.valueType === "time") return "time";
  return `num:${series.unit}`;
}

function makeIndexTransform(values: Array<number | null>): (value: number | null) => number | null {
  const base = values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (base == null) return () => null;
  return (value) => (value == null || !Number.isFinite(value) ? null : Math.round((value / base) * 100));
}

function resolveMode(series: MetricSeries[], trendMode: "auto" | "normalized" | "raw"): ChartMode {
  if (trendMode === "normalized") return "index";
  const sameKey = new Set(series.map(comparabilityKey)).size <= 1;
  if (trendMode === "raw") return series.length === 2 && !sameKey ? "dual-axis" : "raw-single";
  if (sameKey) return "raw-single";
  return series.length === 2 ? "dual-axis" : "index";
}

export function resolveChartLayout(series: MetricSeries[], trendMode: "auto" | "normalized" | "raw"): ChartLayout {
  const mode = resolveMode(series, trendMode);
  const transforms = new Map<string, (value: number | null) => number | null>();
  const axes = new Map<string, "y" | "y1">();
  series.forEach((item, index) => {
    transforms.set(
      item.metricId,
      mode === "index" ? makeIndexTransform(item.points.map((point) => point.value)) : identity,
    );
    axes.set(item.metricId, mode === "dual-axis" && index === 1 ? "y1" : "y");
  });
  return {
    mode,
    axisOf: (metricId) => axes.get(metricId) ?? "y",
    transformOf: (metricId) => transforms.get(metricId) ?? identity,
  };
}

export function buildChartRows(series: MetricSeries[], layout: ChartLayout, rollingWindows: number[]): ChartRowsResult {
  const dates = series[0]?.points.map((point) => point.date) ?? [];
  const rows: ChartRow[] = dates.map((_, index) => {
    const row: ChartRow = { date: dates[index] };
    for (const item of series) {
      const transform = layout.transformOf(item.metricId);
      const point = item.points[index];
      row[item.metricId] = transform(point?.value ?? null);
      for (const window of rollingWindows) {
        row[rollingKey(item.metricId, window)] = transform(point?.rolling[String(window)] ?? null);
      }
    }
    return row;
  });
  return { dates, rows };
}

export function computeYDomain(rows: ChartRow[], keys: string[]): [number, number] | null {
  const values: number[] = [];
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "number" && Number.isFinite(value)) values.push(value);
    }
  }
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}
