import type { Icon as PhosphorGlyph } from "@phosphor-icons/react";
import { CheckCircle, Clock, DotOutline, Lock, PushPin, Target, WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon.js";
import type { GoalGraphLod } from "../../lib/goalGraphLod.js";
import type { GoalGraphNode, GoalGraphNodeKind, GoalGraphNodeStatus } from "../../lib/goalGraphModel.js";
import { GoalStarCore } from "./GoalStarCore.js";

export interface GoalGraphNodeViewProps {
  node: GoalGraphNode;
  selected: boolean;
  lod: GoalGraphLod;
  pinned?: boolean;
  lively?: boolean;
  handles?: ReactNode;
  actions?: ReactNode;
  onRestoreAuto?: () => void;
}

const KIND_LABEL: Record<GoalGraphNodeKind, string> = {
  task: "任务",
  track: "轨道",
  goal: "目标",
  ghost: "缺失引用",
};

const STATUS_META = {
  ready: {
    label: "就绪",
    icon: DotOutline,
    className: "border-border bg-surface-elevated text-ink-2",
    glowClassName: "shadow-[var(--shadow-galaxy-ready)]",
  },
  blocked: {
    label: "受阻",
    icon: WarningCircle,
    className: "border-border-strong bg-danger-soft text-danger",
    glowClassName: "shadow-[var(--shadow-galaxy-blocked)]",
  },
  completed: {
    label: "已完成",
    icon: CheckCircle,
    className: "border-border bg-ok text-page",
    glowClassName: "shadow-[var(--shadow-galaxy-completed)]",
  },
  parked: {
    label: "停放",
    icon: Lock,
    className: "border-border bg-surface-elevated text-ink-3",
    glowClassName: "shadow-[var(--shadow-galaxy-parked)]",
  },
  active: {
    label: "进行中",
    icon: Clock,
    className: "border-border bg-accent-soft text-accent",
    glowClassName: "shadow-[var(--shadow-galaxy-active)]",
  },
  ghost: {
    label: "缺失引用",
    icon: WarningCircle,
    className: "border-border border-dashed bg-surface text-ink-3",
    glowClassName: "shadow-none",
  },
  anchor: {
    label: "目标锚点",
    icon: Target,
    className: "border-border-strong bg-accent text-page",
    glowClassName: "shadow-[var(--shadow-galaxy-anchor)]",
  },
} satisfies Record<
  GoalGraphNodeStatus,
  { label: string; icon: PhosphorGlyph; className: string; glowClassName: string }
>;

const SHAPE_CLASS: Record<GoalGraphNodeKind, string> = {
  task: "h-10 w-10 rounded-pill",
  track: "min-h-12 min-w-36 rounded-pill px-4",
  goal: "h-28 w-28 rounded-pill px-4",
  ghost: "min-h-12 min-w-28 rounded-card border-dashed px-3 opacity-70",
};

const FAR_SHAPE_CLASS: Record<GoalGraphNodeKind, string> = {
  task: "h-9 w-9 rounded-pill",
  track: "h-9 min-w-24 rounded-pill px-3",
  goal: "h-20 w-20 rounded-pill px-3",
  ghost: "h-9 min-w-20 rounded-card border-dashed px-2 opacity-70",
};

function shortTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 14)}...`;
}

export function GoalGraphNodeView({
  node,
  selected,
  lod,
  pinned = false,
  lively = false,
  handles,
  actions,
  onRestoreAuto,
}: GoalGraphNodeViewProps) {
  const statusMeta = STATUS_META[node.status];
  const title = shortTitle(node.title);
  const isFar = lod === "far";
  const shapeClass = isFar ? FAR_SHAPE_CLASS[node.kind] : SHAPE_CLASS[node.kind];
  const selectedClass = selected ? "border-border-strong ring-2 ring-accent" : "";
  const ghostClass = node.kind === "ghost" || node.status === "ghost" ? "opacity-70" : "";
  const livelyClass = lively ? "motion-safe:animate-pulse" : "";
  const ariaLabel = `${KIND_LABEL[node.kind]}：${node.title}，状态：${statusMeta.label}`;
  const showTitleInsideShape = node.kind !== "task";
  const isGoal = node.kind === "goal";

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-node-kind={node.kind}
      data-node-status={node.status}
      data-selected={selected ? "true" : "false"}
      data-galaxy-lively={lively ? "true" : undefined}
      aria-describedby={`goal-graph-tooltip-${node.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
      className="group/goal-node relative inline-flex items-center text-sm"
    >
      <span
        data-goal-graph-node-shape="true"
        data-goal-star-shell={isGoal ? "true" : undefined}
        data-status-glow={node.kind === "task" || node.kind === "track" ? node.status : undefined}
        className={`relative inline-flex items-center justify-center gap-2 border shadow-sm ${shapeClass} ${
          isGoal
            ? "border-[var(--galaxy-star-core)] bg-surface-elevated/85 text-ink shadow-[var(--shadow-galaxy-star-core)]"
            : statusMeta.className
        } ${isGoal ? "" : statusMeta.glowClassName} ${selectedClass} ${ghostClass} ${livelyClass}`}
      >
        {handles}
        {pinned && onRestoreAuto ? (
          <button
            type="button"
            aria-label="恢复自动布局"
            title="恢复自动布局"
            onClick={(event) => {
              event.stopPropagation();
              onRestoreAuto();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="nodrag nopan absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-pill border border-border bg-surface-elevated text-accent shadow-sm transition-colors hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <Icon icon={PushPin} size={12} />
          </button>
        ) : pinned ? (
          <span
            role="img"
            aria-label="已固定位置"
            className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-pill border border-border bg-surface-elevated text-accent shadow-sm"
          >
            <Icon icon={PushPin} size={12} />
          </span>
        ) : null}
        {isGoal ? (
          <span className="flex min-w-0 flex-col items-center gap-1">
            <GoalStarCore label={isFar ? "" : "◎"} size={isFar ? "sm" : "md"} />
            <span className={isFar ? "sr-only" : "max-w-24 truncate text-center text-xs font-semibold text-ink"}>
              {title}
            </span>
            <span className={isFar ? "sr-only" : "text-[10px] text-[var(--galaxy-star-core)]"}>
              {statusMeta.label}
            </span>
          </span>
        ) : (
          <Icon icon={statusMeta.icon} size={isFar ? 16 : 18} label={statusMeta.label} className="shrink-0" />
        )}

        {!isGoal && showTitleInsideShape && (
          <span className={`min-w-0 ${isFar ? "sr-only" : "flex flex-col leading-tight"}`}>
            {!isFar && <span className="max-w-36 truncate font-medium text-current">{title}</span>}
            <span className={isFar ? "sr-only" : "text-xs text-current opacity-80"}>{statusMeta.label}</span>
          </span>
        )}
      </span>

      {!showTitleInsideShape && !isFar && (
        <span
          data-goal-graph-node-label="true"
          className="nodrag nopan absolute left-full top-1/2 ml-2 min-w-0 -translate-y-1/2 leading-tight"
        >
          <span className="block max-w-40 truncate font-medium text-ink">{title}</span>
          <span className="block text-xs text-ink-3">{statusMeta.label}</span>
        </span>
      )}

      {!showTitleInsideShape && isFar && <span className="sr-only">{statusMeta.label}</span>}

      {actions && <span className="ml-2 inline-flex shrink-0 items-center gap-1">{actions}</span>}

      <span
        id={`goal-graph-tooltip-${node.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
        role="tooltip"
        data-goal-graph-node-tooltip="true"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 whitespace-normal break-words rounded-card border border-border-strong bg-surface-elevated/95 px-3 py-2 text-left text-xs leading-relaxed text-ink opacity-0 shadow-elev2 backdrop-blur-sm transition-opacity delay-150 group-hover/goal-node:opacity-100 group-focus-within/goal-node:opacity-100"
      >
        <span className="block font-medium">{node.title}</span>
        <span className="mt-0.5 block text-ink-3">{statusMeta.label}</span>
      </span>
    </div>
  );
}
