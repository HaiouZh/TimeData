import type { ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricChartBlock as MetricChartBlockConfig } from "@timedata/shared";
import {
  getChartSeries,
  normalizeTo100,
  type ChartSeriesRange,
  type HealthMetricCollections,
  type MetricSeries,
} from "../../../lib/healthMetrics/index.ts";

const COLORS = ["#22c55e", "#14b8a6", "#f59e0b", "#ef4444", "#38bdf8", "#a855f7"];

function isNormalized(config: MetricChartBlockConfig): boolean {
  if (config.trendMode === "normalized") return true;
  if (config.trendMode === "raw") return false;
  return config.metricIds.length > 1;
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export function MetricChartBlock({
  config,
  collections,
  range,
}: {
  config: MetricChartBlockConfig;
  collections: HealthMetricCollections;
  range: ChartSeriesRange;
}) {
  const result = getChartSeries(
    { metricIds: config.metricIds, rollingWindows: config.rollingWindows, range, clampToDataStart: true },
    collections,
  );
  const normalized = isNormalized(config);

  const dates = result.series[0]?.points.map((point) => point.date) ?? [];
  const displayBySeries = new Map<string, Array<number | null>>();
  for (const series of result.series) {
    const raw = series.points.map((point) => point.value);
    displayBySeries.set(series.metricId, normalized ? normalizeTo100(raw) : raw);
  }

  const rows = dates.map((date, index) => {
    const row: Record<string, number | string | null> = { date };
    for (const series of result.series) {
      row[series.metricId] = displayBySeries.get(series.metricId)?.[index] ?? null;
    }
    return row;
  });

  const hasData = result.series.some((series) => series.points.some((point) => point.value != null));
  const onlyPace = result.series.length === 1 && result.series[0]?.valueType === "pace" && !normalized;

  function renderTooltip({ active, label }: { active?: boolean; label?: unknown }) {
    if (!active) return null;
    const index = dates.indexOf(String(label));
    if (index < 0) return null;
    return (
      <div className="health-chart-tooltip">
        <div className="health-chart-tooltip-title">{String(label)}</div>
        {result.series.map((series) => (
          <div key={series.metricId} className="health-chart-tooltip-row">
            <span>{series.label}</span>
            <strong>{series.points[index]?.formattedValue ?? "--"}</strong>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="health-panel" aria-label={config.title}>
      <div className="health-panel-header">
        <h3 className="health-panel-title">{config.title}</h3>
        <span className="health-panel-meta">{normalized ? "归一化 0-100" : ""}</span>
      </div>

      {!hasData ? (
        <div className="health-empty-inline">暂无数据</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          {renderChart(config, result.series, rows, normalized, onlyPace, renderTooltip)}
        </ResponsiveContainer>
      )}
    </section>
  );
}

function renderChart(
  config: MetricChartBlockConfig,
  series: MetricSeries[],
  rows: Array<Record<string, number | string | null>>,
  normalized: boolean,
  onlyPace: boolean,
  tooltip: (props: { active?: boolean; label?: unknown }) => ReactElement | null,
) {
  const yProps = normalized
    ? { domain: [0, 100] as [number, number], ticks: [0, 25, 50, 75, 100] }
    : onlyPace
      ? { reversed: true }
      : {};
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.75)" />;
  const x = <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />;
  const y = <YAxis {...yProps} tick={{ fill: "#94a3b8", fontSize: 12 }} />;
  const legend = <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />;
  const tip = <Tooltip content={tooltip} />;
  const referenceLine =
    config.showAverageLine && series.length === 1 ? (
      <ReferenceLine y={avgOf(rows, series[0]?.metricId ?? "") ?? undefined} stroke="#94a3b8" strokeDasharray="4 4" />
    ) : null;

  if (config.chartKind === "bar" && series.length === 1) {
    return (
      <BarChart data={rows}>
        {grid}
        {x}
        {y}
        {tip}
        {legend}
        {referenceLine}
        <Bar dataKey={series[0].metricId} name={series[0].label} fill={COLORS[0]} />
      </BarChart>
    );
  }
  if (config.chartKind === "area") {
    return (
      <AreaChart data={rows}>
        {grid}
        {x}
        {y}
        {tip}
        {legend}
        {referenceLine}
        {series.map((item, index) => (
          <Area
            key={item.metricId}
            type="monotone"
            dataKey={item.metricId}
            name={item.label}
            stroke={COLORS[index % COLORS.length]}
            fill={COLORS[index % COLORS.length]}
            fillOpacity={0.35}
            connectNulls
          />
        ))}
      </AreaChart>
    );
  }
  return (
    <LineChart data={rows}>
      {grid}
      {x}
      {y}
      {tip}
      {legend}
      {referenceLine}
      {series.map((item, index) => (
        <Line
          key={item.metricId}
          type="monotone"
          dataKey={item.metricId}
          name={item.label}
          stroke={COLORS[index % COLORS.length]}
          strokeWidth={2.2}
          dot={false}
          connectNulls
        />
      ))}
    </LineChart>
  );
}

function avgOf(rows: Array<Record<string, number | string | null>>, key: string): number | null {
  return average(rows.map((row) => (typeof row[key] === "number" ? (row[key] as number) : null)));
}
