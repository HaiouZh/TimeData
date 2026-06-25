import "@xyflow/react/dist/style.css";

import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import type { Goal, GoalLayoutPin, Task, Track, TrackStep } from "@timedata/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { clusterLod, type ClusterLod, type GalaxyViewport } from "../../lib/goalGalaxyLod.js";
import { goalGalaxyLayout, type XY } from "../../lib/goalGalaxyLayout.js";
import { buildGoalGalaxyModel, type GalaxyNode } from "../../lib/goalGalaxyModel.js";
import { goalGalaxyRollup } from "../../lib/goalGalaxyRollup.js";
import type { GoalGraphNode } from "../../lib/goalGraphModel.js";
import { goalPinFromCanvas, memberPinFromCanvas } from "../../lib/goalLayoutCoords.js";
import { deleteGoalLayoutPin, upsertGoalLayoutPin } from "../../lib/goalLayoutPins.js";
import { toggleTaskDone } from "../../lib/tasks.js";
import { GoalGalaxyHud } from "./GoalGalaxyHud.js";
import { GoalGalaxyActionBar } from "./GoalGalaxyActionBar.js";
import { GoalGraphNodeView } from "./GoalGraphNodeView.js";
import { GoalStarNode, type GoalStarNodeData } from "./GoalStarNode.js";
import { actionsForNode, type GoalAction } from "./goalGraphActions.js";
import { galaxyPinRef } from "./galaxyPinRef.js";

export interface GoalGalaxyCanvasProps {
  goals: Goal[];
  tasks: Task[];
  tracks: Track[];
  steps: TrackStep[];
  layoutPins: GoalLayoutPin[];
  onNavigate: (to: string) => void;
}

interface GoalGalaxyMemberNodeData extends Record<string, unknown> {
  node: GoalGraphNode;
  anchorIds: string[];
  pinned: boolean;
}

type GoalGalaxyFlowNode =
  | Node<GoalStarNodeData, "goal-star">
  | Node<GoalGalaxyMemberNodeData, "goal-galaxy-member">;

type GoalGalaxyFlowEdge = Edge<Record<string, unknown>>;

const DEFAULT_VIEWPORT: GalaxyViewport = { x: 0, y: 0, zoom: 1 };
const DEFAULT_CLUSTER_BOUNDS = { x: -260, y: -260, width: 520, height: 520 };
const nodeTypes = {
  "goal-star": GoalStarNode,
  "goal-galaxy-member": GoalGalaxyMemberNode,
};

function GoalGalaxyMemberNode({ data, selected }: { data: GoalGalaxyMemberNodeData; selected?: boolean }) {
  return <GoalGraphNodeView node={data.node} selected={selected === true} lod="near" pinned={data.pinned} />;
}

function fallbackStarPosition(index: number): XY {
  if (index === 0) return { x: 0, y: 0 };
  const angle = index * 2.399963229728653;
  const radius = 360 * Math.sqrt(index);
  return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
}

function splitPins(layoutPins: GoalLayoutPin[], goals: Goal[]): {
  anchorCanvasById: Record<string, XY>;
  memberPinByNodeId: Record<string, { goalId: string; x: number; y: number }>;
} {
  const anchorCanvasById: Record<string, XY> = {};
  const memberPinByNodeId: Record<string, { goalId: string; x: number; y: number }> = {};

  for (const [index, goal] of goals.filter((goal) => goal.status === "active").entries()) {
    anchorCanvasById[`goal:${goal.id}`] = fallbackStarPosition(index);
  }

  for (const pin of layoutPins) {
    if (pin.nodeKind === "goal") {
      anchorCanvasById[`goal:${pin.nodeId}`] = { x: pin.x, y: pin.y };
      continue;
    }
    memberPinByNodeId[`goal:${pin.goalId}|${pin.nodeKind}:${pin.nodeId}`] = { goalId: pin.goalId, x: pin.x, y: pin.y };
  }

  return { anchorCanvasById, memberPinByNodeId };
}

function goalIdFromStarNodeId(nodeId: string): string | null {
  if (!nodeId.startsWith("goal:")) return null;
  const goalId = nodeId.slice("goal:".length);
  return goalId.length > 0 ? goalId : null;
}

function goalIdsFromAnchorIds(anchorIds: string[]): string[] {
  return anchorIds.flatMap((anchorId) => {
    if (!anchorId.startsWith("goal:")) return [];
    const goalId = anchorId.slice("goal:".length);
    return goalId ? [goalId] : [];
  });
}

export async function restoreGalaxyPin({
  nodeId,
  anchorIds,
  syncAfterWrite,
}: {
  nodeId: string;
  anchorIds: string[];
  syncAfterWrite: () => void;
}): Promise<void> {
  const ref = galaxyPinRef(nodeId, goalIdsFromAnchorIds(anchorIds));
  if (!ref) return;

  await deleteGoalLayoutPin(ref);
  syncAfterWrite();
}

function toGraphNode(node: GalaxyNode): GoalGraphNode {
  return {
    id: node.id,
    kind: node.kind,
    status: node.status as GoalGraphNode["status"],
    title: node.title,
    ref: node.ref,
    hasDependency: false,
  };
}

function toStarGraphNode(star: GoalStarNodeData["star"]): GoalGraphNode {
  return {
    id: star.nodeId,
    kind: "goal",
    status: "anchor",
    title: star.title,
    ref: null,
    hasDependency: false,
  };
}

export function GoalGalaxyCanvas(props: GoalGalaxyCanvasProps) {
  return (
    <ReactFlowProvider>
      <GoalGalaxyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function GoalGalaxyCanvasInner({ goals, tasks, tracks, steps, layoutPins, onNavigate }: GoalGalaxyCanvasProps) {
  const flow = useReactFlow();
  const { syncAfterWrite } = useSyncContext();
  const [viewport, setViewport] = useState<GalaxyViewport>(() => flow.getViewport?.() ?? DEFAULT_VIEWPORT);
  const [lodByGoalId, setLodByGoalId] = useState<Record<string, ClusterLod>>({});
  const [initialFitGoalKey, setInitialFitGoalKey] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { anchorCanvasById, memberPinByNodeId } = useMemo(() => splitPins(layoutPins, goals), [goals, layoutPins]);
  const activeGoalIds = useMemo(() => goals.filter((goal) => goal.status === "active").map((goal) => goal.id), [goals]);
  const activeGoalKey = activeGoalIds.join("\n");
  const activeGoalCount = activeGoalIds.length;
  useEffect(() => {
    setLodByGoalId((current) => {
      const next: Record<string, ClusterLod> = {};
      for (const goal of goals) {
        if (goal.status !== "active") continue;
        next[goal.id] = clusterLod(DEFAULT_CLUSTER_BOUNDS, viewport, current[goal.id] ?? "collapsed");
      }
      return next;
    });
  }, [goals, viewport]);
  const model = useMemo(
    () => buildGoalGalaxyModel({ goals, tasks, tracks, steps, lodByGoalId }),
    [goals, lodByGoalId, steps, tasks, tracks],
  );
  const layout = useMemo(
    () => goalGalaxyLayout({ model, anchorCanvasById, memberPinByNodeId }),
    [anchorCanvasById, memberPinByNodeId, model],
  );
  const rollup = useMemo(() => goalGalaxyRollup(goals, tasks, tracks, steps), [goals, steps, tasks, tracks]);
  const pinnedStarIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pin of layoutPins) {
      if (pin.nodeKind === "goal") ids.add(`goal:${pin.nodeId}`);
    }
    return ids;
  }, [layoutPins]);
  const pinnedMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pin of layoutPins) {
      if (pin.nodeKind !== "goal") ids.add(`${pin.nodeKind}:${pin.nodeId}`);
    }
    return ids;
  }, [layoutPins]);
  const nodes = useMemo<GoalGalaxyFlowNode[]>(() => {
    const starNodes = model.stars.map(
      (star) =>
        ({
          id: star.nodeId,
          type: "goal-star",
          position: layout.positions[star.nodeId] ?? { x: 0, y: 0 },
          draggable: true,
          selected: star.nodeId === selectedNodeId,
          data: { star, pinned: pinnedStarIds.has(star.nodeId) },
        }) satisfies GoalGalaxyFlowNode,
    );
    const memberNodes = model.nodes.map(
      (node) =>
        ({
          id: node.id,
          type: "goal-galaxy-member",
          position: layout.positions[node.id] ?? { x: 0, y: 0 },
          draggable: node.anchorIds.length === 1,
          selected: node.id === selectedNodeId,
          data: { node: toGraphNode(node), anchorIds: node.anchorIds, pinned: pinnedMemberIds.has(node.id) },
        }) satisfies GoalGalaxyFlowNode,
    );
    return [...starNodes, ...memberNodes];
  }, [layout.positions, model.nodes, model.stars, pinnedMemberIds, pinnedStarIds, selectedNodeId]);
  const edges = useMemo<GoalGalaxyFlowEdge[]>(
    () =>
      model.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: { kind: edge.kind },
      })),
    [model.edges],
  );
  useEffect(() => {
    if (initialFitGoalKey === activeGoalKey) return;
    if (activeGoalCount === 0) return;
    if (Object.keys(lodByGoalId).length < activeGoalCount) return;
    void flow.fitView({ padding: 0.2 });
    setInitialFitGoalKey(activeGoalKey);
  }, [activeGoalCount, activeGoalKey, flow, initialFitGoalKey, lodByGoalId]);

  const onNodeDoubleClick = useCallback<NodeMouseHandler<GoalGalaxyFlowNode>>(
    (_event, node) => {
      const goalId = goalIdFromStarNodeId(node.id);
      if (!goalId) return;
      onNavigate(`/goals/${goalId}`);
    },
    [onNavigate],
  );

  const onNodeClick = useCallback<NodeMouseHandler<GoalGalaxyFlowNode>>((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onNodeDragStop = useCallback<NodeMouseHandler<GoalGalaxyFlowNode>>(
    (_event, node) => {
      const anchorIds = Array.isArray(node.data.anchorIds) ? node.data.anchorIds : [];
      const ref = galaxyPinRef(node.id, goalIdsFromAnchorIds(anchorIds));
      if (!ref) return;

      if (ref.nodeKind === "goal") {
        const coords = goalPinFromCanvas(node.position);
        void upsertGoalLayoutPin({ ...ref, x: coords.x, y: coords.y }).then(syncAfterWrite);
        return;
      }

      const anchor = anchorCanvasById[`goal:${ref.goalId}`] ?? { x: 0, y: 0 };
      const coords = memberPinFromCanvas(node.position, anchor);
      void upsertGoalLayoutPin({ ...ref, x: coords.x, y: coords.y }).then(syncAfterWrite);
    },
    [anchorCanvasById, syncAfterWrite],
  );

  function handleMoveEnd(_event: MouseEvent | TouchEvent | null, nextViewport: Viewport): void {
    setViewport(nextViewport);
  }

  const selectedFlowNode = useMemo(
    () => (selectedNodeId ? (nodes.find((node) => node.id === selectedNodeId) ?? null) : null),
    [nodes, selectedNodeId],
  );
  const selectedGraphNode = useMemo(() => {
    if (!selectedFlowNode) return null;
    if (selectedFlowNode.type === "goal-star") return toStarGraphNode(selectedFlowNode.data.star);
    return selectedFlowNode.data.node;
  }, [selectedFlowNode]);
  const selectedNodeActions = useMemo(() => {
    if (!selectedGraphNode || !selectedFlowNode) return [];
    return actionsForNode(selectedGraphNode, {
      pinned: selectedFlowNode.data.pinned === true,
    });
  }, [selectedFlowNode, selectedGraphNode]);

  function clearSelection(): void {
    setSelectedNodeId(null);
  }

  function runNodeAction(action: GoalAction): void {
    if (!selectedFlowNode || !selectedGraphNode) return;
    if (action.id === "open" && selectedGraphNode.ref?.kind === "task") {
      onNavigate(`/todo?taskId=${selectedGraphNode.ref.id}`);
      return;
    }
    if (action.id === "open" && selectedGraphNode.ref?.kind === "track") {
      onNavigate(`/tracks/${selectedGraphNode.ref.id}`);
      return;
    }
    if (action.id === "toggle-complete" && selectedGraphNode.ref?.kind === "task") {
      void toggleTaskDone(selectedGraphNode.ref.id).then(syncAfterWrite);
      return;
    }
    if (action.id === "restore-auto") {
      void restoreGalaxyPin({
        nodeId: selectedFlowNode.id,
        anchorIds: "anchorIds" in selectedFlowNode.data ? selectedFlowNode.data.anchorIds : [],
        syncAfterWrite,
      });
    }
  }

  return (
    <div data-galaxy className="relative h-full min-h-[520px] overflow-hidden bg-page text-ink">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        nodeOrigin={[0.5, 0.5]}
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={clearSelection}
        onMoveEnd={handleMoveEnd}
        className="h-full w-full"
      >
        <Background />
      </ReactFlow>
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <GoalGalaxyHud rollup={rollup} />
      </div>
      <GoalGalaxyActionBar
        node={selectedGraphNode}
        actions={selectedNodeActions}
        onAction={runNodeAction}
        onClose={clearSelection}
      />
    </div>
  );
}
