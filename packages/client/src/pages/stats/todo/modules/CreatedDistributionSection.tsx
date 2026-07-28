import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { creationEvents } from "../../../../lib/todoStats/events.ts";
import { weeklyDistribution } from "../../../../lib/todoStats/distribution.ts";
import type { TodoStatsModuleProps } from "../types.ts";

const WEEKS = 12;

function weekLabel(weekStart: string): string {
  return weekStart.slice(5);
}

export default function CreatedDistributionSection({ tasks, today }: TodoStatsModuleProps) {
  const events = creationEvents(tasks).map((task) => task.createdAt);
  const data = weeklyDistribution(events, today, WEEKS).map((point) => ({
    ...point,
    label: weekLabel(point.weekStart),
  }));

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h3 className="text-sm font-medium text-fg-muted">创建分布</h3>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="count" name="新建" fill="var(--color-primary, #3b82f6)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
