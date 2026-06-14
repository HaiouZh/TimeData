import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NormalizedHealthTrendPoint } from "../../../lib/healthMetrics/index.ts";

const SERIES = [
  { key: "sleep", label: "睡眠", color: "#22c55e" },
  { key: "hrv", label: "HRV", color: "#14b8a6" },
  { key: "stress", label: "压力", color: "#f59e0b" },
  { key: "heartRate", label: "静息心率", color: "#ef4444" },
] as const;

type TrendMetricKey = Exclude<keyof NormalizedHealthTrendPoint, "date">;

type ChartRow = {
  date: string;
  sleep: number | null;
  hrv: number | null;
  stress: number | null;
  heartRate: number | null;
  raw: NormalizedHealthTrendPoint;
};

export function HealthMetricTrendChart({ data }: { data: NormalizedHealthTrendPoint[] }) {
  const chartData: ChartRow[] = data.map((row) => ({
    ...row,
    sleep: row.sleep.normalized,
    hrv: row.hrv.normalized,
    stress: row.stress.normalized,
    heartRate: row.heartRate.normalized,
    raw: row,
  }));

  return (
    <section className="health-panel" aria-label="健康趋势">
      <div className="health-panel-header">
        <h3 className="health-panel-title">健康趋势</h3>
        <span className="health-panel-meta">归一化 0-100</span>
      </div>

      {chartData.length === 0 ? (
        <div className="health-empty-inline">暂无健康数据</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.75)" />
            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as ChartRow;
                return (
                  <div className="health-chart-tooltip">
                    <div className="health-chart-tooltip-title">{label}</div>
                    {SERIES.map((item) => {
                      const point = row.raw[item.key as TrendMetricKey];
                      const normalized = row[item.key];
                      return (
                        <div key={item.key} className="health-chart-tooltip-row">
                          <span>{item.label}</span>
                          <strong>{point.formatted ?? "--"}</strong>
                          <span>{normalized == null ? "--" : `${normalized}`}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
            {SERIES.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                strokeWidth={2.2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
