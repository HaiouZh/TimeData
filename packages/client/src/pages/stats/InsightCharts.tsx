import { memo } from "react";
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
