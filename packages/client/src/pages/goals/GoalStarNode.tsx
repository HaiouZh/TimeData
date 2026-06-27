import { PushPin } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon.js";
import type { GalaxyStar } from "../../lib/goalGalaxyModel.js";
import { GoalStarCore } from "./GoalStarCore.js";

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

  return (
    <div
      role="group"
      aria-label={`目标：${star.title}，进度：${pct}%`}
      data-goal-star-shell="true"
      className={`relative inline-flex flex-col items-center justify-center rounded-pill border border-[var(--galaxy-star-core)] bg-surface-elevated/85 text-center text-ink shadow-[0_0_34px_rgba(155,188,255,0.2)] ${
        star.lod === "collapsed" ? "h-20 w-20 gap-0 px-2 py-2" : "h-36 w-36 gap-1 px-4 py-4"
      } ${data.lively ? "motion-safe:animate-pulse" : ""}`}
      data-star-id={star.nodeId}
      data-star-lod={star.lod}
      data-galaxy-lively={data.lively ? "true" : undefined}
    >
      {data.handles}
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
          className="nodrag nopan absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-pill border border-border bg-surface-elevated text-accent shadow-sm transition-colors hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <Icon icon={PushPin} size={12} />
        </button>
      ) : data.pinned ? (
        <span
          role="img"
          aria-label="已固定位置"
          className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-pill border border-border bg-surface-elevated text-accent shadow-sm"
        >
          <Icon icon={PushPin} size={12} />
        </span>
      ) : null}
      <GoalStarCore pct={pct} label={`${pct}%`} size={star.lod === "collapsed" ? "md" : "lg"} />
      <span
        data-star-title="true"
        className={star.lod === "collapsed" ? "sr-only" : "w-full truncate text-sm font-semibold"}
      >
        {star.title}
      </span>
      <span data-star-member-count="true" className={star.lod === "collapsed" ? "sr-only" : "text-xs text-ink-3"}>
        {star.memberCount} 项
      </span>
    </div>
  );
}
