import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cycleMetrics } from "../../../../lib/todoStats/cycle.ts";
import type { TodoStatsModuleProps } from "../types.ts";

export default function CycleMetricsSection({ tasks, today }: TodoStatsModuleProps) {
  const metrics = cycleMetrics(tasks, today);
  const medianText =
    metrics.medianTurnaroundDays === null ? "—" : `${metrics.medianTurnaroundDays.toFixed(1)}天`;

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h3 className="td-text-label font-medium text-ink-2">周期指标</h3>
      <p className="mt-1 td-text-caption text-ink-3">
        周转中位数 {medianText}（仅一次性任务） · 日均完成 {metrics.avgCompletedPerDay.toFixed(1)} · 当前连击{" "}
        {metrics.currentStreak}天 · 最长连击 {metrics.longestStreak}天
      </p>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={metrics.turnaroundBuckets}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="count" name="周转分布" fill="var(--color-accent)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
