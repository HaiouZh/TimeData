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
import type { ChartBlock as MetricChartBlockConfig } from "@timedata/shared";
import {
  buildChartRows,
  computeYDomain,
  formatAxisPace,
  getChartSeries,
  rollingKey,
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
  const { dates, rows } = buildChartRows(result.series, { normalized, rollingWindows: config.rollingWindows });

  const hasData = result.series.some((series) => series.points.some((point) => point.value != null));
  const onlyPace = result.series.length === 1 && result.series[0]?.valueType === "pace" && !normalized;

  function renderTooltip({
    active,
    label,
    payload,
  }: {
    active?: boolean;
    label?: unknown;
    payload?: Array<{ dataKey?: string; name?: string }>;
  }) {
    if (!active) return null;
    const index = dates.indexOf(String(label));
    if (index < 0 || !payload?.length) return null;
    return (
      <div className="health-chart-tooltip">
        <div className="health-chart-tooltip-title">{String(label)}</div>
        {payload.map((entry) => {
          const dataKey = entry.dataKey ?? "";
          const series = result.series.find((item) => dataKey === item.metricId || dataKey.startsWith(`${item.metricId}:rolling:`));
          if (!series) return null;
          return (
            <div key={dataKey || series.metricId} className="health-chart-tooltip-row">
              <span>{entry.name ?? seriesDisplayName(series)}</span>
              <strong>{formatTooltipValue(series, dataKey, index)}</strong>
            </div>
          );
        })}
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
        <ResponsiveContainer width="100%" height={config.presentation.height ?? 250}>
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
  const yProps = resolveYProps(config, rows, series, normalized, onlyPace);
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.75)" />;
  const x = <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />;
  const y = <YAxis {...yProps} tick={{ fill: "#94a3b8", fontSize: 12 }} />;
  const legend = <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />;
  const tip = <Tooltip content={tooltip} />;
  const rollingLines = config.rollingWindows.flatMap((window) =>
    series.map((item, index) => (
      <Line
        key={rollingKey(item.metricId, window)}
        type="monotone"
        dataKey={rollingKey(item.metricId, window)}
        name={rollingDisplayName(item, window)}
        stroke={COLORS[index % COLORS.length]}
        strokeWidth={1.4}
        strokeDasharray="5 4"
        dot={false}
        connectNulls
      />
    )),
  );
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
        <Bar dataKey={series[0].metricId} name={seriesDisplayName(series[0])} fill={COLORS[0]} />
        {rollingLines}
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
            name={seriesDisplayName(item)}
            stroke={COLORS[index % COLORS.length]}
            fill={COLORS[index % COLORS.length]}
            fillOpacity={0.35}
            connectNulls
          />
        ))}
        {rollingLines}
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
          name={seriesDisplayName(item)}
          stroke={COLORS[index % COLORS.length]}
          strokeWidth={2.2}
          dot={false}
          connectNulls
        />
      ))}
      {rollingLines}
    </LineChart>
  );
}

function avgOf(rows: Array<Record<string, number | string | null>>, key: string): number | null {
  return average(rows.map((row) => (typeof row[key] === "number" ? (row[key] as number) : null)));
}

function resolveYProps(
  config: MetricChartBlockConfig,
  rows: Array<Record<string, number | string | null>>,
  series: MetricSeries[],
  normalized: boolean,
  onlyPace: boolean,
): {
  domain?: [number, number];
  ticks?: number[];
  reversed?: boolean;
  tickFormatter?: (value: number | string) => string;
} {
  if (normalized) return { domain: [0, 100], ticks: [0, 25, 50, 75, 100] };

  const keys = series.flatMap((item) => [
    item.metricId,
    ...config.rollingWindows.map((window) => rollingKey(item.metricId, window)),
  ]);
  const auto = computeYDomain(rows, keys);
  const manual = config.presentation.yAxis;
  let domain = auto;
  if (manual && typeof manual === "object") {
    const lo = manual.min ?? auto?.[0];
    const hi = manual.max ?? auto?.[1];
    if (lo != null && hi != null) domain = [lo, hi];
  }

  const props: {
    domain?: [number, number];
    reversed?: boolean;
    tickFormatter?: (value: number | string) => string;
  } = {};
  if (domain) props.domain = domain;
  if (onlyPace) {
    props.reversed = true;
    props.tickFormatter = formatAxisPace;
  }
  return props;
}

function seriesDisplayName(series: MetricSeries): string {
  return series.valueType === "pace" ? `${series.label} /km` : series.label;
}

function rollingDisplayName(series: MetricSeries, window: number): string {
  return series.valueType === "pace" ? `${series.label} ${window}日均值 /km` : `${series.label} ${window}日均值`;
}

function formatTooltipValue(series: MetricSeries, dataKey: string, index: number): string {
  if (dataKey.startsWith(`${series.metricId}:rolling:`)) {
    const window = dataKey.slice(`${series.metricId}:rolling:`.length);
    return series.points[index]?.formattedRolling[window] ?? "--";
  }
  return series.points[index]?.formattedValue ?? "--";
}
