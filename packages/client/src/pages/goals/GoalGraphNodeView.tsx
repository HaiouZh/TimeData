import type { ReactNode } from "react";
import { CheckCircle, Clock, DotOutline, Lock, Target, WarningCircle } from "@phosphor-icons/react";
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import type { GoalGraphLod } from "../../lib/goalGraphLod.js";
import type { GoalGraphNode, GoalGraphNodeKind, GoalGraphNodeStatus } from "../../lib/goalGraphModel.js";

export interface GoalGraphNodeViewProps {
  node: GoalGraphNode;
  selected: boolean;
  lod: GoalGraphLod;
  actions?: ReactNode;
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
  },
  blocked: {
    label: "受阻",
    icon: WarningCircle,
    className: "border-border-strong bg-danger-soft text-danger",
  },
  completed: {
    label: "已完成",
    icon: CheckCircle,
    className: "border-border bg-ok text-page",
  },
  parked: {
    label: "停放",
    icon: Lock,
    className: "border-border bg-surface-elevated text-ink-3",
  },
  active: {
    label: "进行中",
    icon: Clock,
    className: "border-border bg-accent-soft text-accent",
  },
  ghost: {
    label: "缺失引用",
    icon: WarningCircle,
    className: "border-border border-dashed bg-surface text-ink-3",
  },
  anchor: {
    label: "目标锚点",
    icon: Target,
    className: "border-border-strong bg-accent text-page",
  },
} satisfies Record<GoalGraphNodeStatus, { label: string; icon: PhosphorGlyph; className: string }>;

const SHAPE_CLASS: Record<GoalGraphNodeKind, string> = {
  task: "h-10 w-10 rounded-pill",
  track: "min-h-12 min-w-36 rounded-pill px-4",
  goal: "min-h-16 min-w-44 rounded-card px-5",
  ghost: "min-h-12 min-w-28 rounded-card border-dashed px-3 opacity-70",
};

const FAR_SHAPE_CLASS: Record<GoalGraphNodeKind, string> = {
  task: "h-9 w-9 rounded-pill",
  track: "h-9 min-w-24 rounded-pill px-3",
  goal: "h-12 min-w-32 rounded-card px-4",
  ghost: "h-9 min-w-20 rounded-card border-dashed px-2 opacity-70",
};

function shortTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 14)}...`;
}

export function GoalGraphNodeView({ node, selected, lod, actions }: GoalGraphNodeViewProps) {
  const statusMeta = STATUS_META[node.status];
  const title = shortTitle(node.title);
  const isFar = lod === "far";
  const shapeClass = isFar ? FAR_SHAPE_CLASS[node.kind] : SHAPE_CLASS[node.kind];
  const selectedClass = selected ? "border-border-strong ring-2 ring-accent" : "";
  const ghostClass = node.kind === "ghost" || node.status === "ghost" ? "opacity-70" : "";
  const ariaLabel = `${KIND_LABEL[node.kind]}：${node.title}，状态：${statusMeta.label}`;
  const showTitleInsideShape = node.kind !== "task";

  return (
    <div
      aria-label={ariaLabel}
      data-node-kind={node.kind}
      data-node-status={node.status}
      data-selected={selected ? "true" : "false"}
      className="inline-flex items-center gap-2 text-sm"
    >
      <span
        className={`inline-flex items-center justify-center gap-2 border shadow-sm ${shapeClass} ${statusMeta.className} ${selectedClass} ${ghostClass}`}
      >
        <Icon icon={statusMeta.icon} size={isFar ? 16 : 18} label={statusMeta.label} className="shrink-0" />

        {showTitleInsideShape && (
          <span className={`min-w-0 ${isFar ? "sr-only" : "flex flex-col leading-tight"}`}>
            {!isFar && <span className="max-w-36 truncate font-medium text-current">{title}</span>}
            <span className={isFar ? "sr-only" : "text-xs text-current opacity-80"}>{statusMeta.label}</span>
          </span>
        )}
      </span>

      {!showTitleInsideShape && !isFar && (
        <span className="min-w-0 leading-tight">
          <span className="block max-w-40 truncate font-medium text-ink">{title}</span>
          <span className="block text-xs text-ink-3">{statusMeta.label}</span>
        </span>
      )}

      {!showTitleInsideShape && isFar && <span className="sr-only">{statusMeta.label}</span>}

      {actions && <span className="ml-1 inline-flex shrink-0 items-center gap-1">{actions}</span>}
    </div>
  );
}
