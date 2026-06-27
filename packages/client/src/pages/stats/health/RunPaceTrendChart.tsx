import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAxisPace, type RunPaceTrendPoint } from "../../../lib/healthMetrics/index.ts";
import { CHART_CHROME, DATA_PALETTE } from "./chartColors.js";

export function RunPaceTrendChart({ data }: { data: RunPaceTrendPoint[] }) {
  return (
    <section className="health-panel" aria-label="跑步配速趋势">
      <div className="health-panel-header">
        <h3 className="health-panel-title">跑步配速</h3>
        <span className="health-panel-meta">最近 3 / 5 / 10 次</span>
      </div>

      {data.length === 0 ? (
        <div className="health-empty-inline">暂无跑步数据</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_CHROME.grid} />
            <XAxis dataKey="date" tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} />
            <YAxis reversed tickFormatter={formatAxisPace} tick={{ fill: CHART_CHROME.tick, fontSize: 12 }} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as RunPaceTrendPoint;
                return (
                  <div className="health-chart-tooltip">
                    <div className="health-chart-tooltip-title">{label}</div>
                    <div className="health-chart-tooltip-row">
                      <span>配速</span>
                      <strong>{row.paceFormatted}</strong>
                    </div>
                    <div className="health-chart-tooltip-row">
                      <span>近 3 次</span>
                      <strong>{row.rolling3Formatted}</strong>
                    </div>
                    <div className="health-chart-tooltip-row">
                      <span>近 5 次</span>
                      <strong>{row.rolling5Formatted}</strong>
                    </div>
                    <div className="health-chart-tooltip-row">
                      <span>近 10 次</span>
                      <strong>{row.rolling10Formatted}</strong>
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ color: CHART_CHROME.legend, fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="paceSecondsPerKm"
              name="配速"
              stroke={DATA_PALETTE.blue}
              strokeWidth={2.25}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rolling3SecondsPerKm"
              name="近 3 次"
              stroke={DATA_PALETTE.green}
              strokeWidth={1.8}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rolling5SecondsPerKm"
              name="近 5 次"
              stroke={DATA_PALETTE.amber}
              strokeWidth={1.8}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rolling10SecondsPerKm"
              name="近 10 次"
              stroke={DATA_PALETTE.red}
              strokeWidth={1.8}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
