import type { GoalOverview } from "../../lib/goalsView.js";
import { Link } from "react-router-dom";

function kindLabel(kind: "project" | "theme"): string {
  return kind === "project" ? "项目" : "主题";
}

function progressText(overview: GoalOverview): string {
  const { progress } = overview;
  if (progress.kind === "project") return `${progress.completed}/${progress.total}`;
  return `近${progress.windowDays}天 ${progress.activeMemberCount} 个活跃`;
}

export function GoalListItem({ overview }: { overview: GoalOverview }) {
  return (
    <Link
      to={`/goals/${overview.goal.id}`}
      className="block rounded-card border border-border bg-surface px-3 py-3 text-ink hover:border-accent"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-sm font-medium">{overview.goal.title}</h2>
            <span className="rounded-pill bg-surface-elevated px-2 py-0.5 text-xs text-ink-3">
              {kindLabel(overview.goal.kind)}
            </span>
          </div>
          {overview.goal.note && <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-3">{overview.goal.note}</p>}
        </div>
        <span className="shrink-0 rounded-ctl bg-surface-elevated px-2 py-1 text-xs text-ink-2">{progressText(overview)}</span>
      </div>
    </Link>
  );
}
