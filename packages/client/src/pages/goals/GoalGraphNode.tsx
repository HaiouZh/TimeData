import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import type { GoalGraphOrientation } from "../../lib/goalGraphLayout.js";
import { lodFromZoom } from "../../lib/goalGraphLod.js";
import type { GoalGraphNode as GoalGraphNodeModel } from "../../lib/goalGraphModel.js";
import { GoalGraphNodeView } from "./GoalGraphNodeView.js";

export interface GoalGraphNodeData extends Record<string, unknown> {
  node: GoalGraphNodeModel;
  orientation: GoalGraphOrientation;
  pinned?: boolean;
}

export type GoalGraphFlowNode = Node<GoalGraphNodeData, "goal-graph-node">;

const HANDLE_CLASS =
  "!h-2.5 !w-2.5 !border !border-accent-ink/70 !bg-accent-ink/70 !shadow-none !opacity-0 transition-opacity group-hover/goal-node:!opacity-60 focus-visible:!opacity-100 focus-visible:!ring-2 focus-visible:!ring-accent";

const HANDLE_POSITIONS = [
  { id: "left", position: Position.Left },
  { id: "right", position: Position.Right },
  { id: "top", position: Position.Top },
  { id: "bottom", position: Position.Bottom },
] as const;

function canRenderHandles(node: GoalGraphNodeModel): boolean {
  return node.kind !== "goal" && node.kind !== "ghost";
}

export function GoalGraphNode({ data, selected, isConnectable }: NodeProps<GoalGraphFlowNode>) {
  const zoom = useStore((state) => state.transform[2]);
  const lod = lodFromZoom(zoom);
  const renderHandles = canRenderHandles(data.node);

  const handleClassName = selected ? `${HANDLE_CLASS} !opacity-70` : HANDLE_CLASS;
  const handleElements = renderHandles ? (
    <>
      <Handle
        key="target-center"
        id="target-center"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={handleClassName}
      />
      <Handle
        key="source-center"
        id="source-center"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={handleClassName}
      />
      {HANDLE_POSITIONS.map((handle) => (
        <Handle
          key={`target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          isConnectable={isConnectable}
          className={handleClassName}
        />
      ))}
      {HANDLE_POSITIONS.map((handle) => (
        <Handle
          key={`source-${handle.id}`}
          id={`source-${handle.id}`}
          type="source"
          position={handle.position}
          isConnectable={isConnectable}
          className={handleClassName}
        />
      ))}
    </>
  ) : null;

  return (
    <GoalGraphNodeView
      node={data.node}
      selected={selected}
      lod={lod}
      pinned={data.pinned === true}
      handles={handleElements}
    />
  );
}
