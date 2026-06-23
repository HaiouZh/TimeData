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
    strokeWidth: 1.75,
    strokeLinecap: "round",
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

  return (
    <>
      {kind === "prerequisite" && !markerEnd && (
        <defs>
          <marker
            id={arrowMarkerId}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={PREREQUISITE_STROKE} />
          </marker>
        </defs>
      )}

      <BaseEdge
        id={id}
        path={path}
        markerEnd={resolvedMarkerEnd}
        interactionWidth={interactionWidth}
        style={{ ...EDGE_STYLE[kind], ...style }}
      />
    </>
  );
}
