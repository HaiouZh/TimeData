import type { MetricSeries } from "./types.js";

export type ChartRow = Record<string, number | string | null>;

export interface ChartRowsResult {
  dates: string[];
  rows: ChartRow[];
}

export function rollingKey(metricId: string, window: number): string {
  return `${metricId}:rolling:${window}`;
}

function makeTransform(
  rawValues: Array<number | null>,
  normalized: boolean,
): (value: number | null) => number | null {
  if (!normalized) return (value) => value;
  const present = rawValues.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) return () => null;
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (present.length === 1 || min === max) {
    return (value) => (value == null || !Number.isFinite(value) ? null : 50);
  }
  return (value) => (value == null || !Number.isFinite(value) ? null : Math.round(((value - min) / (max - min)) * 100));
}

export function buildChartRows(
  series: MetricSeries[],
  options: { normalized: boolean; rollingWindows: number[] },
): ChartRowsResult {
  const dates = series[0]?.points.map((point) => point.date) ?? [];
  const transforms = new Map<string, (value: number | null) => number | null>();
  for (const item of series) {
    transforms.set(item.metricId, makeTransform(item.points.map((point) => point.value), options.normalized));
  }
  const rows: ChartRow[] = dates.map((_, index) => {
    const row: ChartRow = { date: dates[index] };
    for (const item of series) {
      const transform = transforms.get(item.metricId);
      if (!transform) continue;
      const point = item.points[index];
      row[item.metricId] = transform(point?.value ?? null);
      for (const window of options.rollingWindows) {
        row[rollingKey(item.metricId, window)] = transform(point?.rolling[String(window)] ?? null);
      }
    }
    return row;
  });
  return { dates, rows };
}
