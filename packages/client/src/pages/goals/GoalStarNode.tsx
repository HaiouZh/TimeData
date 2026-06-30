import { PushPin } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon.js";
import type { GalaxyStar } from "../../lib/goalGalaxyModel.js";

export interface GoalStarNodeData extends Record<string, unknown> {
  star: GalaxyStar;
  pinned?: boolean;
  lively?: boolean;
  handles?: ReactNode;
  onRestoreAuto?: () => void;
}

export function GoalStarNode({ data }: { data: GoalStarNodeData }) {
  const { star } = data;
  const pct = star.total === 0 ? 0 : Math.round((star.completed / star.total) * 100);
  const collapsed = star.lod === "collapsed";
  const progressDeg = pct * 3.6;

  return (
    <div
      role="group"
      aria-label={`目标：${star.title}，进度：${pct}%`}
      data-goal-star-shell="true"
      className={`relative inline-flex items-center justify-center rounded-pill border border-[var(--galaxy-star-core)] bg-surface-elevated/85 text-center text-ink shadow-[var(--shadow-galaxy-star-core-wide)] ${
        collapsed ? "h-20 w-20" : "h-36 w-36"
      } ${data.lively ? "motion-safe:animate-pulse" : ""}`}
      data-star-id={star.nodeId}
      data-star-lod={star.lod}
      data-galaxy-lively={data.lively ? "true" : undefined}
    >
      {data.handles}
      <span
        data-goal-star-progress-ring="true"
        aria-hidden="true"
        className="absolute inset-0 rounded-pill opacity-90"
        style={{ background: `conic-gradient(var(--galaxy-edge) ${progressDeg}deg, var(--border) 0deg)` }}
      />
      <span aria-hidden="true" className="absolute inset-2 rounded-pill bg-surface-elevated" />
      {data.pinned && data.onRestoreAuto ? (
        <button
          type="button"
          aria-label="恢复自动布局"
          title="恢复自动布局"
          onClick={(event) => {
            event.stopPropagation();
            data.onRestoreAuto?.();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="nodrag nopan absolute -right-1 -top-1 z-10 inline-flex h-6 w-6 items-center justify-center rounded-pill border border-border bg-surface-elevated text-accent shadow-sm transition-colors hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <Icon icon={PushPin} size={12} />
        </button>
      ) : data.pinned ? (
        <span
          role="img"
          aria-label="已固定位置"
          className="absolute -right-1 -top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-pill border border-border bg-surface-elevated text-accent shadow-sm"
        >
          <Icon icon={PushPin} size={12} />
        </span>
      ) : null}
      <span
        className={`relative z-10 flex min-w-0 flex-col items-center justify-center ${
          collapsed ? "gap-0 px-2" : "gap-0.5 px-5"
        }`}
      >
        <span
          data-star-title="true"
          className={collapsed ? "sr-only" : "td-text-label w-full truncate font-semibold leading-tight"}
        >
          {star.title}
        </span>
        <span
          data-progress={pct}
          className={`font-semibold tabular-nums text-[var(--galaxy-star-core)] ${collapsed ? "td-text-label" : "td-text-caption"}`}
        >
          {pct}%
        </span>
        <span data-star-member-count="true" className={collapsed ? "sr-only" : "td-text-caption text-ink-3"}>
          {star.memberCount} 项
        </span>
      </span>
    </div>
  );
}
