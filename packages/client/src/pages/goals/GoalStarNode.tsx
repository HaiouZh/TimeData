import type { GalaxyStar } from "../../lib/goalGalaxyModel.js";

export interface GoalStarNodeData extends Record<string, unknown> {
  star: GalaxyStar;
}

export function GoalStarNode({ data }: { data: GoalStarNodeData }) {
  const { star } = data;
  const pct = star.total === 0 ? 0 : Math.round((star.completed / star.total) * 100);

  return (
    <div
      aria-label={`目标：${star.title}，进度：${pct}%`}
      className="inline-flex min-w-36 max-w-44 flex-col items-center gap-1 rounded-card border border-border bg-surface-elevated px-3 py-2 text-center text-ink shadow-sm"
      data-star-id={star.nodeId}
    >
      <span
        data-progress={pct}
        className="inline-flex h-10 w-10 items-center justify-center rounded-pill border border-accent bg-accent-soft text-xs font-semibold text-accent"
      >
        {pct}%
      </span>
      <span className="w-full truncate text-sm font-medium">{star.title}</span>
      <span className="text-xs text-ink-3">{star.memberCount} 项</span>
    </div>
  );
}
