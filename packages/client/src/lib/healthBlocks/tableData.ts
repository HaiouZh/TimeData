import type { HealthRun } from "@timedata/shared";
import {
  formatDistanceKm,
  formatDuration,
  formatPace,
  getChartSeries,
  secondsPerKm,
  type ChartSeriesRange,
  type HealthMetricCollections,
} from "../healthMetrics/index.js";
import type { TableColumn, TableData, TableRow } from "./csv.js";

export interface BuildMetricTableRowsInput {
  metricIds: string[];
  columnIds: string[];
  rollingWindows: number[];
  range: ChartSeriesRange;
  hideEmptyRows: boolean;
  maxRows: number | null;
  collections: HealthMetricCollections;
}

export interface BuildRunTableRowsInput {
  runs: readonly HealthRun[];
  columnIds: string[];
  range: ChartSeriesRange;
  maxRows: number | null;
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function filterByRange<T extends { date: string }>(records: readonly T[], range: ChartSeriesRange): T[] {
  if (range.mode === "all") return [...records];
  if (range.mode === "manual") return records.filter((record) => record.date >= range.from && record.date <= range.to);

  const lastDate = records.reduce<string | null>((latest, record) => (latest == null || record.date > latest ? record.date : latest), null);
  if (lastDate == null) return [];
  const from = addUtcDays(lastDate, -(range.days - 1));
  return records.filter((record) => record.date >= from && record.date <= lastDate);
}

function parseRollingColumn(columnId: string): { metricId: string; window: string } | null {
  const match = /^(.*):rolling:(\d+)$/.exec(columnId);
  if (!match) return null;
  return { metricId: match[1], window: match[2] };
}

export function buildMetricTableRows(input: BuildMetricTableRowsInput): TableData {
  const result = getChartSeries(
    { metricIds: input.metricIds, rollingWindows: input.rollingWindows, range: input.range, clampToDataStart: true },
    input.collections,
  );
  const seriesById = new Map(result.series.map((series) => [series.metricId, series]));
  const dates = result.series[0]?.points.map((point) => point.date) ?? [];

  const columns: TableColumn[] = input.columnIds.map((columnId) => {
    if (columnId === "date") return { id: "date", label: "日期" };
    const rolling = parseRollingColumn(columnId);
    const series = seriesById.get(rolling?.metricId ?? columnId);
    if (!series) return { id: columnId, label: columnId };
    if (rolling) return { id: columnId, label: `${series.label} ${rolling.window}日均值`, unit: series.unit };
    return { id: columnId, label: series.label, unit: series.unit };
  });

  const rows: TableRow[] = dates.map((date, index) => {
    const cells: TableRow["cells"] = { date: { raw: date, formatted: date } };
    for (const column of columns) {
      if (column.id === "date") continue;
      const rolling = parseRollingColumn(column.id);
      const series = seriesById.get(rolling?.metricId ?? column.id);
      const point = series?.points[index];
      if (rolling) {
        const value = point?.rolling[rolling.window] ?? null;
        cells[column.id] = { raw: value, formatted: point?.formattedRolling[rolling.window] ?? "--" };
      } else {
        cells[column.id] = { raw: point?.value ?? null, formatted: point?.formattedValue ?? "--" };
      }
    }
    return { id: date, cells };
  });

  const filteredRows = input.hideEmptyRows ? rows.filter((row) => hasNonDateValue(row)) : rows;
  return { columns, rows: input.maxRows == null ? filteredRows : filteredRows.slice(0, input.maxRows) };
}

function hasNonDateValue(row: TableRow): boolean {
  return Object.entries(row.cells).some(([columnId, cell]) => columnId !== "date" && cell.raw != null);
}

const RUN_COLUMNS: Record<string, TableColumn> = {
  date: { id: "date", label: "日期" },
  startTime: { id: "startTime", label: "开始" },
  distanceKm: { id: "distanceKm", label: "距离", unit: "km" },
  duration: { id: "duration", label: "时长" },
  pace: { id: "pace", label: "配速" },
  averageHeartRate: { id: "averageHeartRate", label: "心率", unit: "bpm" },
  city: { id: "city", label: "城市" },
  type: { id: "type", label: "类型" },
};

function runCell(run: HealthRun, columnId: string): { raw: number | string | null; formatted: string } {
  if (columnId === "date") return { raw: run.date, formatted: run.date };
  if (columnId === "startTime") return { raw: run.startTime, formatted: run.startTime };
  if (columnId === "distanceKm") return { raw: run.distanceKm, formatted: formatDistanceKm(run.distanceKm) ?? "--" };
  if (columnId === "duration") return { raw: run.durationSeconds, formatted: formatDuration(run.durationSeconds) };
  if (columnId === "pace") {
    const value = secondsPerKm(run.durationSeconds, run.distanceKm);
    return { raw: value, formatted: value == null ? "--" : `${formatPace(value)}/km` };
  }
  if (columnId === "averageHeartRate") {
    return { raw: run.averageHeartRate, formatted: run.averageHeartRate == null ? "--" : `${run.averageHeartRate} bpm` };
  }
  if (columnId === "city") return { raw: run.city, formatted: run.city || "--" };
  if (columnId === "type") return { raw: run.type, formatted: run.type || "--" };
  return { raw: null, formatted: "--" };
}

export function buildRunTableRows(input: BuildRunTableRowsInput): TableData {
  const columns = input.columnIds.map((columnId) => RUN_COLUMNS[columnId] ?? { id: columnId, label: columnId });
  const filtered = filterByRange(input.runs, input.range)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
  const visible = input.maxRows == null ? filtered : filtered.slice(0, input.maxRows);
  const rows: TableRow[] = visible.map((run) => ({
    id: run.id,
    cells: Object.fromEntries(columns.map((column) => [column.id, runCell(run, column.id)])),
  }));
  return { columns, rows };
}
