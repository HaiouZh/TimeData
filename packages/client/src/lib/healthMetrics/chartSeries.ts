import { formatClockHours, formatNumberUnit, formatPace, secondsPerKm } from "./format.js";
import { getMetricDef, type DailyMetricDef } from "./registry.js";
import type {
  ChartSeriesResult,
  GetChartSeriesOptions,
  HealthMetricCollections,
  MetricPoint,
  MetricSeries,
} from "./types.js";

export function formatMetricValue(def: DailyMetricDef, value: number | null): string {
  if (def.valueType === "time") return formatClockHours(value);
  if (def.valueType === "pace") return value == null ? "--" : `${formatPace(value)}/km`;
  return formatNumberUnit(value, def.unit);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function enumerateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = new Date(`${from}T00:00:00.000Z`); current.toISOString().slice(0, 10) <= to; current = addUtcDays(current, 1)) {
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

function resolveDates(dataDates: string[], options: GetChartSeriesOptions): string[] {
  if (dataDates.length === 0) return [];
  const allDates = enumerateDateRange(dataDates[0], dataDates[dataDates.length - 1]);
  const { range } = options;
  if (range.mode === "manual") {
    return allDates.filter((date) => date >= range.from && date <= range.to);
  }
  if (range.mode === "recent") {
    const anchor = allDates[allDates.length - 1];
    const fromDate = new Date(`${anchor}T00:00:00.000Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - (range.days - 1));
    const from = fromDate.toISOString().slice(0, 10);
    return allDates.filter((date) => date >= from && date <= anchor);
  }
  return allDates;
}

function numberRolling(values: Array<number | null>, index: number, window: number): number | null {
  const collected: number[] = [];
  for (let i = index; i >= 0 && collected.length < window; i--) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) collected.push(value);
  }
  if (collected.length === 0) return null;
  return collected.reduce((sum, value) => sum + value, 0) / collected.length;
}

function paceRolling(
  components: Map<string, { durationSeconds: number; distanceKm: number }>,
  dates: string[],
  index: number,
  window: number,
): number | null {
  let durationSeconds = 0;
  let distanceKm = 0;
  let used = 0;
  for (let i = index; i >= 0 && used < window; i--) {
    const component = components.get(dates[i]);
    if (component && component.durationSeconds > 0 && component.distanceKm > 0) {
      durationSeconds += component.durationSeconds;
      distanceKm += component.distanceKm;
      used += 1;
    }
  }
  return secondsPerKm(durationSeconds, distanceKm);
}

function buildSeries(
  def: DailyMetricDef,
  collections: HealthMetricCollections,
  dates: string[],
  rollingWindows: number[],
): MetricSeries {
  const byDate = def.selectByDate(collections);
  const paceComponents = def.paceComponentsByDate?.(collections);
  const values = dates.map((date) => byDate.get(date) ?? null);

  const points: MetricPoint[] = dates.map((date, index) => {
    const value = values[index];
    const rolling: Record<string, number | null> = {};
    const formattedRolling: Record<string, string> = {};
    for (const window of rollingWindows) {
      const key = String(window);
      const rolled =
        def.valueType === "pace" && paceComponents
          ? paceRolling(paceComponents, dates, index, window)
          : numberRolling(values, index, window);
      rolling[key] = rolled;
      formattedRolling[key] = formatMetricValue(def, rolled);
    }
    return { date, value, formattedValue: formatMetricValue(def, value), rolling, formattedRolling };
  });

  return { metricId: def.id, label: def.label, unit: def.unit, valueType: def.valueType, points };
}

export function getChartSeries(options: GetChartSeriesOptions, collections: HealthMetricCollections): ChartSeriesResult {
  const defs = options.metricIds.map((id) => getMetricDef(id));

  const dateSet = new Set<string>();
  for (const def of defs) {
    for (const date of def.selectByDate(collections).keys()) dateSet.add(date);
  }
  const dataDates = [...dateSet].sort();
  const dates = resolveDates(dataDates, options);

  const series = defs.map((def) => buildSeries(def, collections, dates, options.rollingWindows));
  return { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "", series };
}
