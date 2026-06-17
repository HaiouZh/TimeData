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
  resolveChartLayout,
  rollingKey,
  type ChartLayout,
  type ChartSeriesRange,
  type HealthMetricCollections,
  type MetricSeries,
} from "../../../lib/healthMetrics/index.ts";
import { CHART_CHROME, metricColor } from "./chartColors.js";

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
  const layout = resolveChartLayout(result.series, config.trendMode);
  const { dates, rows } = buildChartRows(result.series, layout, config.rollingWindows);

  const hasData = result.series.some((series) => series.points.some((point) => point.value != null));
  const metaText = layout.mode === "index" ? "指数化 · 基期=100" : layout.mode === "dual-axis" ? "双轴" : "";

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
          const series = result.series.find(
            (item) => dataKey === item.metricId || dataKey.startsWith(`${item.metricId}:rolling:`),
          );
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
        <span className="health-panel-meta">{metaText}</span>
      </div>

      {!hasData ? (
        <div className="health-empty-inline">暂无数据</div>
      ) : (
        <ResponsiveContainer width="100%" height={config.presentation.height ?? 250}>
          {renderChart(config, result.series, rows, layout, renderTooltip)}
        </ResponsiveContainer>
      )}
    </section>
  );
}

function axisKeys(series: MetricSeries[], rollingWindows: number[]): string[] {
  return series.flatMap((item) => [item.metricId, ...rollingWindows.map((window) => rollingKey(item.metricId, window))]);
}

function applyManualDomain(
  auto: [number, number] | null,
  manual: MetricChartBlockConfig["presentation"]["yAxis"],
): [number, number] | null {
  if (!manual || typeof manual !== "object") return auto;
  const lo = manual.min ?? auto?.[0];
  const hi = manual.max ?? auto?.[1];
  return lo != null && hi != null ? [lo, hi] : auto;
}

function dualSeriesAxisProps(
  item: MetricSeries | undefined,
  config: MetricChartBlockConfig,
  rows: Array<Record<string, number | string | null>>,
): { domain?: [number, number]; reversed?: boolean; tickFormatter?: (value: number | string) => string } {
  if (!item) return {};
  const domain = computeYDomain(rows, axisKeys([item], config.rollingWindows));
  const isPace = item.valueType === "pace";
  return { ...(domain ? { domain } : {}), ...(isPace ? { reversed: true, tickFormatter: formatAxisPace } : {}) };
}

function renderYAxes(
  config: MetricChartBlockConfig,
  rows: Array<Record<string, number | string | null>>,
  series: MetricSeries[],
  layout: ChartLayout,
  seriesColors: string[],
): ReactElement[] {
  const neutralTick = { fill: CHART_CHROME.tick, fontSize: 12 };
  if (layout.mode === "dual-axis") {
    return [
      <YAxis
        key="y"
        yAxisId="y"
        width={40}
        tick={{ fill: seriesColors[0] ?? CHART_CHROME.tick, fontSize: 12 }}
        {...dualSeriesAxisProps(series[0], config, rows)}
      />,
      <YAxis
        key="y1"
        yAxisId="y1"
        orientation="right"
        width={40}
        tick={{ fill: seriesColors[1] ?? CHART_CHROME.tick, fontSize: 12 }}
        {...dualSeriesAxisProps(series[1], config, rows)}
      />,
    ];
  }
  const auto = computeYDomain(rows, axisKeys(series, config.rollingWindows));
  if (layout.mode === "index") {
    const domain = auto ? ([Math.min(100, auto[0]), Math.max(100, auto[1])] as [number, number]) : undefined;
    return [
      <YAxis
        key="y"
        yAxisId="y"
        width={40}
        tick={neutralTick}
        {...(domain ? { domain } : {})}
        tickFormatter={(value: number | string) => `${value}%`}
      />,
    ];
  }
  const domain = applyManualDomain(auto, config.presentation.yAxis);
  const onlyPace = series.length === 1 && series[0]?.valueType === "pace";
  return [
    <YAxis
      key="y"
      yAxisId="y"
      width={onlyPace ? 48 : 40}
      tick={neutralTick}
      {...(domain ? { domain } : {})}
      {...(onlyPace ? { reversed: true, tickFormatter: formatAxisPace } : {})}
    />,
  ];
}

function renderChart(
  config: MetricChartBlockConfig,
  series: MetricSeries[],
  rows: Array<Record<string, number | string | null>>,
  layout: ChartLayout,
  tooltip: (props: { active?: boolean; label?: unknown }) => ReactElement | null,
) {
  const claimed = new Set<string>();
  const seriesColors = series.map((item) => metricColor(item.metricId, claimed));
  const grid = <CartesianGrid strokeDasharray="3 3" stroke={CHART_CHROME.grid} />;
  const x = <XAxis dataKey="date" tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} />;
  const yAxes = renderYAxes(config, rows, series, layout, seriesColors);
  const legend = <Legend wrapperStyle={{ color: CHART_CHROME.legend, fontSize: 12 }} />;
  const tip = <Tooltip content={tooltip} />;
  const baseline =
    layout.mode === "index" ? <ReferenceLine yAxisId="y" y={100} stroke={CHART_CHROME.reference} strokeDasharray="2 4" /> : null;
  const referenceLine =
    config.showAverageLine && series.length === 1 ? (
      <ReferenceLine
        yAxisId="y"
        y={avgOf(rows, series[0]?.metricId ?? "") ?? undefined}
        stroke={CHART_CHROME.reference}
        strokeDasharray="4 4"
      />
    ) : null;
  const rollingLines = config.rollingWindows.flatMap((window) =>
    series.map((item, index) => (
      <Line
        key={rollingKey(item.metricId, window)}
        yAxisId={layout.axisOf(item.metricId)}
        type="monotone"
        dataKey={rollingKey(item.metricId, window)}
        name={rollingDisplayName(item, window)}
        stroke={seriesColors[index]}
        strokeWidth={1.4}
        strokeDasharray="5 4"
        dot={false}
        connectNulls
      />
    )),
  );

  if (config.chartKind === "bar" && series.length === 1) {
    return (
      <BarChart data={rows}>
        {grid}
        {x}
        {yAxes}
        {tip}
        {legend}
        {baseline}
        {referenceLine}
        <Bar
          yAxisId={layout.axisOf(series[0].metricId)}
          dataKey={series[0].metricId}
          name={seriesDisplayName(series[0])}
          fill={seriesColors[0]}
        />
        {rollingLines}
      </BarChart>
    );
  }
  if (config.chartKind === "area") {
    return (
      <AreaChart data={rows}>
        {grid}
        {x}
        {yAxes}
        {tip}
        {legend}
        {baseline}
        {referenceLine}
        {series.map((item, index) => (
          <Area
            key={item.metricId}
            yAxisId={layout.axisOf(item.metricId)}
            type="monotone"
            dataKey={item.metricId}
            name={seriesDisplayName(item)}
            stroke={seriesColors[index]}
            fill={seriesColors[index]}
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
      {yAxes}
      {tip}
      {legend}
      {baseline}
      {referenceLine}
      {series.map((item, index) => (
        <Line
          key={item.metricId}
          yAxisId={layout.axisOf(item.metricId)}
          type="monotone"
          dataKey={item.metricId}
          name={seriesDisplayName(item)}
          stroke={seriesColors[index]}
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
