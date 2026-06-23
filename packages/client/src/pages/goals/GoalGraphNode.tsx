import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import type { GoalGraphOrientation } from "../../lib/goalGraphLayout.js";
import { lodFromZoom } from "../../lib/goalGraphLod.js";
import type { GoalGraphNode as GoalGraphNodeModel } from "../../lib/goalGraphModel.js";
import { GoalGraphNodeView } from "./GoalGraphNodeView.js";

export interface GoalGraphNodeData extends Record<string, unknown> {
  node: GoalGraphNodeModel;
  orientation: GoalGraphOrientation;
}

export type GoalGraphFlowNode = Node<GoalGraphNodeData, "goal-graph-node">;

const HANDLE_CLASS =
  "!h-3 !w-3 !border-2 !border-page !bg-accent-ink !shadow-sm focus-visible:!ring-2 focus-visible:!ring-accent";

const HANDLE_POSITIONS: Record<
  GoalGraphOrientation,
  {
    target: Position;
    source: Position;
  }
> = {
  horizontal: {
    target: Position.Left,
    source: Position.Right,
  },
  vertical: {
    target: Position.Top,
    source: Position.Bottom,
  },
};

function canRenderHandles(node: GoalGraphNodeModel): boolean {
  return node.kind !== "goal" && node.kind !== "ghost";
}

export function GoalGraphNode({ data, selected, isConnectable }: NodeProps<GoalGraphFlowNode>) {
  const zoom = useStore((state) => state.transform[2]);
  const lod = lodFromZoom(zoom);
  const handles = HANDLE_POSITIONS[data.orientation];
  const renderHandles = canRenderHandles(data.node);

  return (
    <div className="relative inline-flex items-center">
      {renderHandles && (
        <Handle type="target" position={handles.target} isConnectable={isConnectable} className={HANDLE_CLASS} />
      )}

      <GoalGraphNodeView node={data.node} selected={selected} lod={lod} />

      {renderHandles && (
        <Handle type="source" position={handles.source} isConnectable={isConnectable} className={HANDLE_CLASS} />
      )}
    </div>
  );
}
