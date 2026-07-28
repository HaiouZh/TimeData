import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { completionEvents, creationEvents } from "../../../../lib/todoStats/events.ts";
import { completionRate } from "../../../../lib/todoStats/distribution.ts";
import type { TodoStatsModuleProps } from "../types.ts";

const WEEKS = 12;

function weekLabel(weekStart: string): string {
  return weekStart.slice(5);
}

export default function CompletedDistributionSection({ tasks, today }: TodoStatsModuleProps) {
  const created = creationEvents(tasks).map((task) => task.createdAt);
  const completed = completionEvents(tasks).map((event) => event.completedAt);
  const data = completionRate(created, completed, today, WEEKS).map((point) => ({
    ...point,
    label: weekLabel(point.weekStart),
  }));

  const thisWeek = data[data.length - 1];
  const rateText =
    thisWeek && thisWeek.created > 0
      ? `${Math.round((thisWeek.completed / thisWeek.created) * 100)}%`
      : "—";

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h3 className="td-text-label font-medium text-ink-2">完成分布</h3>
      <p className="mt-1 td-text-caption text-ink-3">
        本周完成 {thisWeek?.completed ?? 0} / 新建 {thisWeek?.created ?? 0}（{rateText}）
      </p>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="created" name="新建" fill="var(--color-ink-3)" />
            <Bar dataKey="completed" name="完成" fill="var(--color-accent)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
