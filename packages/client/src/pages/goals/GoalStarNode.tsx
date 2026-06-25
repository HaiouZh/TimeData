import { PushPin } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import type { GalaxyStar } from "../../lib/goalGalaxyModel.js";

export interface GoalStarNodeData extends Record<string, unknown> {
  star: GalaxyStar;
  pinned?: boolean;
}

export function GoalStarNode({ data }: { data: GoalStarNodeData }) {
  const { star } = data;
  const pct = star.total === 0 ? 0 : Math.round((star.completed / star.total) * 100);

  return (
    <div
      role="group"
      aria-label={`目标：${star.title}，进度：${pct}%`}
      className="relative inline-flex min-w-36 max-w-44 flex-col items-center gap-1 rounded-card border border-border bg-surface-elevated px-3 py-2 text-center text-ink shadow-sm"
      data-star-id={star.nodeId}
    >
      {data.pinned && (
        <span
          role="img"
          aria-label="已固定位置"
          className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-pill border border-border bg-surface-elevated text-accent shadow-sm"
        >
          <Icon icon={PushPin} size={12} />
        </span>
      )}
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
