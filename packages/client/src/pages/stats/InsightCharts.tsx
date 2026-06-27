import { memo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CHROME } from "./health/chartColors.js";

export interface TrendSeriesItem {
  key: string;
  color: string;
}

export type TrendChartKind = "line" | "area";
export type TrendChartRow = Record<string, number | string>;



function formatTooltipValue(value: unknown, suffix: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${String(value)} ${suffix}`;
  const formatted = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
  return `${formatted} ${suffix}`;
}

const tooltipStyle = {
  background: CHART_CHROME.tooltipBg,
  border: `1px solid ${CHART_CHROME.tooltipBorder}`,
  borderRadius: 14,
  color: CHART_CHROME.tooltipText,
  boxShadow: CHART_CHROME.tooltipShadow,
};

export const TrendChart = memo(function TrendChart({
  chart,
  data,
  series,
  yAxisUnit = "h",
  tooltipSuffix = "小时",
  yAxisDomain,
  yAxisTicks,
}: {
  chart: TrendChartKind;
  data: TrendChartRow[];
  series: TrendSeriesItem[];
  yAxisUnit?: string;
  tooltipSuffix?: string;
  yAxisDomain?: [number | string, number | string];
  yAxisTicks?: number[];
}) {
  const tooltipFormatter = (value: unknown) => formatTooltipValue(value, tooltipSuffix);
  return (
    <div className="min-h-[220px] px-1 py-3">
      <ResponsiveContainer width="100%" height={220}>
        {chart === "line" ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_CHROME.grid} />
            <XAxis dataKey="date" tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} />
            <YAxis
              unit={yAxisUnit}
              tick={{ fill: CHART_CHROME.tick, fontSize: 12 }}
              domain={yAxisDomain}
              ticks={yAxisTicks}
            />
            <Tooltip
              formatter={tooltipFormatter}
              contentStyle={tooltipStyle}
              cursor={{ stroke: CHART_CHROME.cursor, strokeOpacity: 0.32 }}
            />
            <Legend wrapperStyle={{ color: CHART_CHROME.legend, fontSize: 12 }} />
            {series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stroke={item.color}
                strokeWidth={2.25}
                dot={false}
              />
            ))}
          </LineChart>
        ) : (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_CHROME.grid} />
            <XAxis dataKey="date" tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} />
            <YAxis
              unit={yAxisUnit}
              tick={{ fill: CHART_CHROME.tick, fontSize: 12 }}
              domain={yAxisDomain}
              ticks={yAxisTicks}
            />
            <Tooltip
              formatter={tooltipFormatter}
              contentStyle={tooltipStyle}
              cursor={{ stroke: CHART_CHROME.cursor, strokeOpacity: 0.32 }}
            />
            <Legend wrapperStyle={{ color: CHART_CHROME.legend, fontSize: 12 }} />
            {series.map((item) => (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stackId="1"
                stroke={item.color}
                strokeWidth={1.75}
                fill={item.color}
                fillOpacity={0.48}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
});

export interface CompositionChild {
  id: string;
  name: string;
  min: number;
  color: string;
}

export interface CompositionParent {
  id: string;
  name: string;
  totalHours: number;
  sharePct: number;
  color: string;
  children: CompositionChild[];
}

export const CategoryCompositionBars = memo(function CategoryCompositionBars({
  parents,
}: {
  parents: CompositionParent[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {parents.map((parent) => {
        const childTotal = parent.children.reduce((sum, child) => sum + child.min, 0) || 1;
        const expanded = expandedId === parent.id;
        return (
          <div key={parent.id} className="rounded-2xl border border-border bg-surface-elevated px-3 py-2">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : parent.id)}
              className="flex min-h-10 w-full items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: parent.color }} />
                <span className="truncate text-ink">{parent.name}</span>
              </span>
              <span className="shrink-0 text-ink-2">
                {parent.totalHours.toFixed(1)}h · {parent.sharePct}%
              </span>
            </button>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-page">
              {parent.children.map((child) => (
                <div
                  key={child.id}
                  className="h-full"
                  style={{ width: `${(child.min / childTotal) * 100}%`, backgroundColor: child.color }}
                  title={`${child.name} ${(child.min / 60).toFixed(1)}h`}
                />
              ))}
            </div>
            {expanded && (
              <ul className="mt-2 space-y-1">
                {parent.children.map((child) => (
                  <li key={child.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: child.color }} />
                      <span className="truncate text-ink-2">{child.name}</span>
                    </span>
                    <span className="shrink-0 text-ink-3">
                      {(child.min / 60).toFixed(1)}h · {Math.round((child.min / childTotal) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
});

export interface DonutDatum {
  id: string;
  name: string;
  value: number;
  color: string;
}

interface DonutTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DonutDatum }>;
  total: number;
}

function DonutTooltip({ active, payload, total }: DonutTooltipProps) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  const pct = total > 0 ? Math.round((datum.value / total) * 1000) / 10 : 0;
  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-xs text-ink shadow-elev2">
      {datum.name} · {datum.value}h · {pct}%
    </div>
  );
}

export const CategoryDonut = memo(function CategoryDonut({
  data,
  totalHours,
  coveragePct,
  coverageNote,
}: {
  data: DonutDatum[];
  totalHours: number;
  coveragePct: number;
  coverageNote: string | null;
}) {
  const total = data.reduce((sum, datum) => sum + datum.value, 0);
  return (
    <div className="relative min-h-[250px] py-2">
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={62}
            outerRadius={92}
            paddingAngle={3}
            cornerRadius={6}
          >
            {data.map((item) => (
              <Cell key={item.id} fill={item.color} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip total={total} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-semibold text-ink">{totalHours.toFixed(1)}h</div>
        <div className="text-xs text-ink-2">覆盖率 {coveragePct.toFixed(1)}%</div>
        {coverageNote && <div className="text-[10px] text-ink-3">{coverageNote}</div>}
      </div>
    </div>
  );
});
