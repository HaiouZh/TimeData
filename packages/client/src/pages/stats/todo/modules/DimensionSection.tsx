import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { projectBreakdown, tagBreakdown } from "../../../../lib/todoStats/dimension.ts";
import type { TodoStatsModuleProps } from "../types.ts";

export default function DimensionSection({ tasks, goals }: TodoStatsModuleProps) {
  const tagRows = tagBreakdown(tasks);
  const projectRows = projectBreakdown(tasks, goals);

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h3 className="text-sm font-medium text-fg-muted">标签维度</h3>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tagRows} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="tag" width={80} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="open" name="未完成" stackId="tag" fill="var(--color-primary, #3b82f6)" />
            <Bar dataKey="done" name="已完成" stackId="tag" fill="var(--color-muted, #94a3b8)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3 className="mt-6 text-sm font-medium text-fg-muted">项目维度</h3>
      {projectRows.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">暂无项目数据</p>
      ) : (
        <div className="mt-2 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={projectRows} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="title" width={80} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="open" name="未完成" stackId="project" fill="var(--color-primary, #3b82f6)" />
              <Bar dataKey="done" name="已完成" stackId="project" fill="var(--color-muted, #94a3b8)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
