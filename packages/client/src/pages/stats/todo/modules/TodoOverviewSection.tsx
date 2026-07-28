import { Link } from "react-router";
import { buildTodoOverview } from "../../../../lib/todoStats/overview.js";
import type { TodoStatsModuleProps } from "../types.ts";

export default function TodoOverviewSection({ tasks, buckets }: TodoStatsModuleProps) {
  const overview = buildTodoOverview(buckets, tasks, new Date());

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h2 className="td-text-label font-medium text-ink-2">总览</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <OverviewCard label="总数" value={overview.total} />
        <OverviewCard label="未完成" value={overview.open} />
        <OverviewCard label="已完成" value={overview.doneTotal} />
        <OverviewCard label="重复规则" value={overview.recurringRules} />
        <OverviewCard label="今天" value={overview.byBucket.today} />
        <OverviewCard label="收件箱" value={overview.byBucket.inbox} />
        <OverviewCard label="已排期" value={overview.byBucket.scheduled} />
        <OverviewCard label="项目" value={overview.byBucket.projects} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to="/todo"
          className="rounded-pill border border-accent px-3 py-1 td-text-caption font-medium text-accent"
        >
          逾期 {overview.overdue}
        </Link>
        <Link
          to="/todo"
          className="rounded-pill border border-accent px-3 py-1 td-text-caption font-medium text-accent"
        >
          无排期 {overview.noSchedule}
        </Link>
      </div>
    </section>
  );
}

function OverviewCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border bg-surface-elevated px-3 py-2">
      <div className="td-text-caption text-ink-2">{label}</div>
      <div className="td-num td-text-title mt-1 leading-none text-ink">{value}</div>
    </div>
  );
}
