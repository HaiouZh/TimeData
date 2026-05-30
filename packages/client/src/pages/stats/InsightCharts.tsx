import { memo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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

export interface PieDatum {
  id: string;
  name: string;
  value: number;
  color: string;
}

export interface TrendSeriesItem {
  key: string;
  color: string;
}

export type TrendChartKind = "line" | "area";
export type TrendChartRow = Record<string, number | string>;

const hourFormatter = (value: unknown) => `${value} 小时`;

export const CategoryPieChart = memo(function CategoryPieChart({ data }: { data: PieDatum[] }) {
  return (
    <div className="min-h-[250px]">
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={({ name, value }) => `${name} ${value}h`}
          >
            {data.map((item) => (
              <Cell key={item.id} fill={item.color} />
            ))}
          </Pie>
          <Tooltip formatter={hourFormatter} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
});

export const CategoryBarChart = memo(function CategoryBarChart({ data }: { data: PieDatum[] }) {
  return (
    <div className="min-h-[200px]">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" unit="h" tick={{ fill: "#94a3b8", fontSize: 12 }} />
          <YAxis type="category" dataKey="name" width={60} tick={{ fill: "#94a3b8", fontSize: 12 }} />
          <Tooltip formatter={hourFormatter} />
          <Bar dataKey="value">
            {data.map((item) => (
              <Cell key={item.id} fill={item.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export const TrendChart = memo(function TrendChart({
  chart,
  data,
  series,
}: {
  chart: TrendChartKind;
  data: TrendChartRow[];
  series: TrendSeriesItem[];
}) {
  return (
    <div className="min-h-[220px]">
      <ResponsiveContainer width="100%" height={220}>
        {chart === "line" ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis unit="h" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <Tooltip formatter={hourFormatter} />
            <Legend />
            {series.map((item) => (
              <Line key={item.key} type="monotone" dataKey={item.key} stroke={item.color} dot={false} />
            ))}
          </LineChart>
        ) : (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis unit="h" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <Tooltip formatter={hourFormatter} />
            <Legend />
            {series.map((item) => (
              <Area key={item.key} type="monotone" dataKey={item.key} stackId="1" stroke={item.color} fill={item.color} />
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
          <div key={parent.id} className="rounded-lg bg-slate-800/60 px-3 py-2">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : parent.id)}
              className="flex w-full items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: parent.color }} />
                <span className="truncate text-slate-200">{parent.name}</span>
              </span>
              <span className="shrink-0 text-slate-400">
                {parent.totalHours.toFixed(1)}h · {parent.sharePct}%
              </span>
            </button>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-900">
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
                      <span className="truncate text-slate-400">{child.name}</span>
                    </span>
                    <span className="shrink-0 text-slate-500">
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
