import type { CSSProperties } from "react";
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { GoalGraphEdge as GoalGraphEdgeModel } from "../../lib/goalGraphModel.js";

export interface GoalGraphEdgeData extends Record<string, unknown> {
  kind: GoalGraphEdgeModel["kind"];
}

export type GoalGraphFlowEdge = Edge<GoalGraphEdgeData, "goal-graph-edge">;

const PREREQUISITE_STROKE = "var(--color-accent-ink)";

const EDGE_STYLE: Record<GoalGraphEdgeModel["kind"], CSSProperties> = {
  prerequisite: {
    stroke: PREREQUISITE_STROKE,
    strokeWidth: 1.1,
    strokeLinecap: "round",
    opacity: 0.5,
  },
  "broken-prerequisite": {
    stroke: "var(--color-ink-3)",
    strokeWidth: 1.5,
    strokeDasharray: "6 4",
    strokeLinecap: "round",
    opacity: 0.72,
  },
  tether: {
    stroke: "var(--color-ink-3)",
    strokeWidth: 1.25,
    strokeLinecap: "round",
    opacity: 0.48,
  },
};

function markerIdForEdge(id: string): string {
  return `goal-graph-prerequisite-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** 按边 id 算一个错峰延迟(ms)，让各条线的流光不同步。 */
function flowDelayForEdge(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash % 1400;
}

export function GoalGraphEdge({
  id,
  data,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps<GoalGraphFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const kind = data?.kind ?? "tether";
  const arrowMarkerId = markerIdForEdge(id);
  const resolvedMarkerEnd = kind === "prerequisite" ? (markerEnd ?? `url(#${arrowMarkerId})`) : undefined;
  const flowDelay = flowDelayForEdge(id);

  return (
    <>
      {kind === "prerequisite" && !markerEnd && (
        <defs>
          <marker
            id={arrowMarkerId}
            markerWidth="14"
            markerHeight="14"
            refX="11"
            refY="7"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 2 2 L 12 7 L 2 12 z" fill={PREREQUISITE_STROKE} opacity={0.95} />
          </marker>
        </defs>
      )}

      {kind === "prerequisite" && (
        <path
          d={path}
          fill="none"
          stroke={PREREQUISITE_STROKE}
          strokeWidth={5}
          strokeOpacity={0.12}
          strokeLinecap="round"
          style={{ pointerEvents: "none" }}
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={resolvedMarkerEnd}
        interactionWidth={interactionWidth}
        style={{ ...EDGE_STYLE[kind], ...style }}
      />
      {kind === "prerequisite" && (
        <path
          className="goal-edge-flow"
          d={path}
          fill="none"
          stroke={PREREQUISITE_STROKE}
          strokeWidth={1.6}
          strokeOpacity={0.85}
          strokeDasharray="2 18"
          strokeLinecap="round"
          style={{ animationDelay: `${flowDelay}ms`, pointerEvents: "none" }}
        />
      )}
    </>
  );
}
