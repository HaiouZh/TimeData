import "@xyflow/react/dist/style.css";

import { CornersOut } from "@phosphor-icons/react";
import type { Goal, GoalLayoutPin, GoalMemberRef, GoalPrerequisite, Task, Track, TrackStep } from "@timedata/shared";
import {
  applyNodeChanges,
  Background,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  Handle,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { ConfirmSheet } from "../../components/ui/ConfirmSheet.js";
import { Sheet } from "../../components/ui/Sheet.js";
import { useGalaxyEngineMode } from "../../lib/galaxyEngineMode.js";
import { computeEdgeRoutings, type HandleBox, type EdgeRouting } from "../../lib/goalEdgeRouting.js";
import { goalGalaxyLayout, type XY } from "../../lib/goalGalaxyLayout.js";
import { type ClusterLod, clusterLod, type GalaxyViewport } from "../../lib/goalGalaxyLod.js";
import { buildGoalGalaxyModel, type GalaxyNode } from "../../lib/goalGalaxyModel.js";
import { goalGalaxyRollup } from "../../lib/goalGalaxyRollup.js";
import { addPrerequisiteEdge, removePrerequisiteEdge, validatePrerequisiteEdge } from "../../lib/goalGraphEdges.js";
import type { GoalGraphEdge, GoalGraphNode } from "../../lib/goalGraphModel.js";
import { goalPinFromCanvas, memberPinFromCanvas } from "../../lib/goalLayoutCoords.js";
import { upsertGoalLayoutPin } from "../../lib/goalLayoutPins.js";
import { useTodoDefaultDestination } from "../../lib/settings/todoDefaultDestinationSetting.js";
import {
  addGoalMember,
  addTaskForGoal,
  deleteGoal,
  removeGoalMember,
  updateGoal,
  updateGoalPrerequisites,
} from "../../lib/goals.js";
import { buildGoalOverview } from "../../lib/goalsView.js";
import { unassignedTasks, unassignedTracks } from "../../lib/goalUnassigned.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { toggleTaskDone } from "../../lib/tasks.js";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { buildGalaxySettleInput } from "./buildGalaxySettleInput.js";
import { GoalAddMemberSheet } from "./GoalAddMemberSheet.js";
import { type GoalEditPatch, GoalEditSheet } from "./GoalEditSheet.js";
import { GoalGalaxyActionBar, GoalGalaxyEdgeActionBar } from "./GoalGalaxyActionBar.js";
import { GoalGalaxyEngineToggle } from "./GoalGalaxyEngineToggle.js";
import { GoalGalaxyHud } from "./GoalGalaxyHud.js";
import { GoalGraphEdge as GoalGraphEdgeView } from "./GoalGraphEdge.js";
import { GoalGraphNodeView } from "./GoalGraphNodeView.js";
import { type GoalIndexItem, GoalIndexPanel } from "./GoalIndexPanel.js";
import { GoalStarNode, type GoalStarNodeData } from "./GoalStarNode.js";
import { GoalUnassignedTray } from "./GoalUnassignedTray.js";
import { ResizableTrayAside } from "./ResizableTrayAside.js";
import { galaxyPinRef } from "./galaxyPinRef.js";
import { seatOrderedActiveGoals } from "./galaxySeatOrder.js";
import { actionsForEdge, actionsForNode, type GoalAction } from "./goalGraphActions.js";
import { readDragRef } from "./goalMemberDragData.js";
import { type GoalStarHitTarget, hitTestGoalStar } from "./goalStarHitTest.js";
import { restoreGalaxyPin } from "./restoreGalaxyPin.js";
import { useGalaxySettleEngine } from "./useGalaxySettleEngine.js";

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
  lod: ClusterLod;
  pinned: boolean;
  lively?: boolean;
  onRestoreAuto?: () => void;
}

type GoalGalaxyFlowNode = Node<GoalStarNodeData, "goal-star"> | Node<GoalGalaxyMemberNodeData, "goal-galaxy-member">;

interface GoalGalaxyEdgeData extends Record<string, unknown> {
  kind: GoalGraphEdge["kind"];
  goalId?: string;
  opacity?: number;
  routing?: EdgeRouting;
}

type GoalGalaxyFlowEdge = Edge<GoalGalaxyEdgeData, "goal-graph-edge">;
type PendingRemoveMember = { goalId: string; node: GoalGraphNode };
type ConnectDraft = { goalId: string; node: GoalGraphNode };
type GraphGoalLike = Pick<Goal, "members" | "prerequisites">;
type BridgeRouteChoice = { goalIds: string[]; nodeTitle: string } | null;

const ADD_MEMBER_ACTION: GoalAction = { id: "add-member", label: "添加成员", tone: "primary" };

const REASON_COPY = {
  "self-reference": "不能连接自己",
  duplicate: "这条前置已存在",
  cycle: "会形成循环前置",
  "goal-anchor": "Goal 锚不参与前置",
  "non-member": "只能连当前目标里的有效成员",
} as const;

const DEFAULT_VIEWPORT: GalaxyViewport = { x: 0, y: 0, zoom: 1 };
const DEFAULT_CLUSTER_BOUNDS = { x: -260, y: -260, width: 520, height: 520 };
const STAR_HIT_FALLBACK = { width: 144, height: 144 };
const DEFAULT_TETHER_OPACITY = 0.05;
const TETHER_OPACITY_MIN = 0;
const TETHER_OPACITY_MAX = 0.5;
type OpacityTarget = "tether" | "prerequisite";
const DEFAULT_PREREQUISITE_OPACITY = 1;
const PREREQUISITE_OPACITY_MIN = 0;
const PREREQUISITE_OPACITY_MAX = 1;
const nodeTypes = {
  "goal-star": GoalStarNode,
  "goal-galaxy-member": GoalGalaxyMemberNode,
};
const edgeTypes = { "goal-graph-edge": GoalGraphEdgeView };
const CONNECT_HANDLE_CLASS =
  "!h-2.5 !w-2.5 !border !border-accent-ink/70 !bg-accent-ink/70 !shadow-none !opacity-0 transition-opacity group-hover/goal-node:!opacity-60 focus-visible:!opacity-100 focus-visible:!ring-2 focus-visible:!ring-accent";
const PASSIVE_HANDLE_CLASS = "nodrag nopan !h-1 !w-1 !border-0 !bg-transparent !opacity-0";
const CENTER_HANDLE_CLASS =
  "nodrag nopan !left-1/2 !top-1/2 !h-1 !w-1 !-translate-x-1/2 !-translate-y-1/2 !border-0 !bg-transparent !opacity-0";
const CONTROL_PILL_CLASS =
  "pointer-events-auto inline-flex h-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface-elevated px-3 text-xs text-ink-2 shadow-sm transition-colors hover:bg-surface-hover hover:text-ink focus:outline-none focus:ring-1 focus:ring-accent aria-pressed:bg-accent aria-pressed:text-page";
const HANDLE_POSITIONS = [
  { id: "left", position: Position.Left },
  { id: "right", position: Position.Right },
  { id: "top", position: Position.Top },
  { id: "bottom", position: Position.Bottom },
] as const;

function GoalGalaxyMemberNode({
  data,
  selected,
  isConnectable,
}: {
  data: GoalGalaxyMemberNodeData;
  selected?: boolean;
  isConnectable?: boolean;
}) {
  return (
    <GoalGraphNodeView
      node={data.node}
      selected={selected === true}
      lod={data.lod === "collapsed" ? "far" : "near"}
      pinned={data.pinned}
      lively={data.lively}
      handles={<GalaxyNodeHandles canConnectPrerequisite={isConnectable === true} />}
      onRestoreAuto={data.pinned ? data.onRestoreAuto : undefined}
    />
  );
}

function GalaxyNodeHandles({ canConnectPrerequisite }: { canConnectPrerequisite: boolean }) {
  const className = canConnectPrerequisite ? CONNECT_HANDLE_CLASS : PASSIVE_HANDLE_CLASS;
  return (
    <>
      <Handle
        id="target-center"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={CENTER_HANDLE_CLASS}
      />
      <Handle
        id="source-center"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={CENTER_HANDLE_CLASS}
      />
      {HANDLE_POSITIONS.map((handle) => (
        <Handle
          key={`target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          isConnectable={canConnectPrerequisite}
          className={className}
        />
      ))}
      {HANDLE_POSITIONS.map((handle) => (
        <Handle
          key={`source-${handle.id}`}
          id={`source-${handle.id}`}
          type="source"
          position={handle.position}
          isConnectable={canConnectPrerequisite}
          className={className}
        />
      ))}
    </>
  );
}

function GalaxyStarHandles() {
  return (
    <>
      <Handle
        id="target-center"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={CENTER_HANDLE_CLASS}
      />
      <Handle
        id="source-center"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={CENTER_HANDLE_CLASS}
      />
    </>
  );
}

function isGalaxyOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-drawer], [data-galaxy-controls]") !== null;
}

function fallbackStarPosition(index: number): XY {
  if (index === 0) return { x: 0, y: 0 };
  const angle = index * 2.399963229728653;
  const radius = 360 * Math.sqrt(index);
  return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
}

function splitPins(
  layoutPins: GoalLayoutPin[],
  goals: Goal[],
): {
  anchorCanvasById: Record<string, XY>;
  memberPinByNodeId: Record<string, { goalId: string; x: number; y: number }>;
} {
  const anchorCanvasById: Record<string, XY> = {};
  const memberPinByNodeId: Record<string, { goalId: string; x: number; y: number }> = {};

  for (const [index, goal] of seatOrderedActiveGoals(goals).entries()) {
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

function refFromGraphNode(node: GoalGraphNode): GoalMemberRef | null {
  return node.ref;
}

function anchorIdsForFlowNode(node: GoalGalaxyFlowNode): string[] {
  return node.type === "goal-galaxy-member" ? node.data.anchorIds : [];
}

function refFromNodeId(id: string): GoalMemberRef | null {
  const separator = id.indexOf(":");
  if (separator < 1) return null;
  const kind = id.slice(0, separator);
  const refId = id.slice(separator + 1);
  if (kind !== "task" && kind !== "track") return null;
  return { kind, id: refId };
}

function nextPrerequisitesWithEdge(
  goal: GraphGoalLike,
  blocker: GoalMemberRef,
  blocked: GoalMemberRef,
): GoalPrerequisite[] {
  return addPrerequisiteEdge(goal, blocker, blocked).prerequisites;
}

function nextPrerequisitesWithoutEdge(
  goal: GraphGoalLike,
  blocker: GoalMemberRef,
  blocked: GoalMemberRef,
): GoalPrerequisite[] {
  return removePrerequisiteEdge(goal, blocker, blocked).prerequisites;
}

function translate(position: XY, delta: XY, factor = 1): XY {
  return { x: position.x + delta.x * factor, y: position.y + delta.y * factor };
}

function shiftGoalMembers(nodes: GoalGalaxyFlowNode[], goalNodeId: string, delta: XY): GoalGalaxyFlowNode[] {
  if (delta.x === 0 && delta.y === 0) return nodes;
  return nodes.map((node) => {
    if (node.type !== "goal-galaxy-member" || !node.data.anchorIds.includes(goalNodeId)) return node;
    const factor = 1 / Math.max(1, node.data.anchorIds.length);
    return { ...node, position: translate(node.position, delta, factor) };
  });
}

function applyGalaxyNodeChanges(
  nodes: GoalGalaxyFlowNode[],
  changes: NodeChange<GoalGalaxyFlowNode>[],
): GoalGalaxyFlowNode[] {
  return changes.reduce((current, change) => {
    if (!("id" in change)) return applyNodeChanges([change], current) as GoalGalaxyFlowNode[];
    const before = current.find((node) => node.id === change.id);
    const next = applyNodeChanges([change], current) as GoalGalaxyFlowNode[];
    if (change.type !== "position" || !before || before.type !== "goal-star") return next;

    const after = next.find((node) => node.id === change.id);
    if (!after) return next;
    const delta = { x: after.position.x - before.position.x, y: after.position.y - before.position.y };
    return shiftGoalMembers(next, change.id, delta);
  }, nodes);
}

function layoutPositionKey(nodes: GoalGalaxyFlowNode[]): string {
  return nodes
    .map((node) => `${node.id}:${node.position.x}:${node.position.y}:${node.draggable === false ? "fixed" : "drag"}`)
    .join("|");
}

function mergeLayoutNodeDataKeepingPositions(
  currentNodes: GoalGalaxyFlowNode[],
  layoutNodes: GoalGalaxyFlowNode[],
): GoalGalaxyFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return layoutNodes.map((layoutNode) => {
    const currentNode = currentById.get(layoutNode.id);
    return currentNode ? { ...layoutNode, position: currentNode.position } : layoutNode;
  });
}

function samePosition(left: XY, right: XY): boolean {
  return left.x === right.x && left.y === right.y;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canReuseGalaxyNode(
  previous: GoalGalaxyFlowNode | undefined,
  next: GoalGalaxyFlowNode,
): previous is GoalGalaxyFlowNode {
  if (
    !previous ||
    previous.type !== next.type ||
    previous.selected !== next.selected ||
    previous.draggable !== next.draggable
  )
    return false;
  if (!samePosition(previous.position, next.position)) return false;

  if (previous.type === "goal-star" && next.type === "goal-star") {
    return (
      previous.data.star === next.data.star &&
      previous.data.pinned === next.data.pinned &&
      previous.data.lively === next.data.lively
    );
  }

  if (previous.type === "goal-galaxy-member" && next.type === "goal-galaxy-member") {
    return (
      previous.data.node.id === next.data.node.id &&
      previous.data.node.title === next.data.node.title &&
      previous.data.node.status === next.data.node.status &&
      previous.data.node.kind === next.data.node.kind &&
      previous.data.lod === next.data.lod &&
      previous.data.pinned === next.data.pinned &&
      previous.data.lively === next.data.lively &&
      sameStringArray(previous.data.anchorIds, next.data.anchorIds)
    );
  }

  return false;
}

function commonGoalIds(first: GoalGalaxyFlowNode | undefined, second: GoalGalaxyFlowNode | undefined): string[] {
  if (!first || !second) return [];
  const firstIds = new Set(goalIdsFromAnchorIds(anchorIdsForFlowNode(first)));
  return goalIdsFromAnchorIds(anchorIdsForFlowNode(second)).filter((goalId) => firstIds.has(goalId));
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
  const wide = useIsWideScreen();
  const boardSignals = useTrackActionTags();
  const [viewport, setViewport] = useState<GalaxyViewport>(() => flow.getViewport?.() ?? DEFAULT_VIEWPORT);
  const [lodByGoalId, setLodByGoalId] = useState<Record<string, ClusterLod>>({});
  const [initialFitGoalKey, setInitialFitGoalKey] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingRemoveMember, setPendingRemoveMember] = useState<PendingRemoveMember | null>(null);
  const [connectDraft, setConnectDraft] = useState<ConnectDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addMemberGoalId, setAddMemberGoalId] = useState<string | null>(null);
  const [goalMenuGoalId, setGoalMenuGoalId] = useState<string | null>(null);
  const [bridgeRouteChoice, setBridgeRouteChoice] = useState<BridgeRouteChoice>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [tetherOpacity, setTetherOpacity] = useState(DEFAULT_TETHER_OPACITY);
  const [opacityTarget, setOpacityTarget] = useState<OpacityTarget>("tether");
  const [prereqOpacity, setPrereqOpacity] = useState(DEFAULT_PREREQUISITE_OPACITY);
  const [engineMode, setEngineMode] = useGalaxyEngineMode();
  const destination = useTodoDefaultDestination();
  const [liveSettle, setLiveSettle] = useState(true);
  const [settleHint, setSettleHint] = useState<string | null>(null);
  const settleEnabled = engineMode === "settle";
  const { anchorCanvasById, memberPinByNodeId } = useMemo(() => splitPins(layoutPins, goals), [goals, layoutPins]);
  const goalById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);
  const activeGoalIds = useMemo(() => goals.filter((goal) => goal.status === "active").map((goal) => goal.id), [goals]);
  const activeGoalKey = useMemo(() => [...activeGoalIds].sort().join("\n"), [activeGoalIds]);
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
  const pinnedStarIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pin of layoutPins) {
      if (pin.nodeKind === "goal") ids.add(`goal:${pin.nodeId}`);
    }
    return ids;
  }, [layoutPins]);
  const layout = useMemo(
    () => goalGalaxyLayout({ model, anchorCanvasById, memberPinByNodeId, pinnedAnchorIds: pinnedStarIds }),
    [anchorCanvasById, memberPinByNodeId, model, pinnedStarIds],
  );
  const rollup = useMemo(() => goalGalaxyRollup(goals, tasks, tracks, steps), [goals, steps, tasks, tracks]);
  const trayTasks = useMemo(() => unassignedTasks(tasks, goals), [goals, tasks]);
  const trayTracks = useMemo(() => unassignedTracks(tracks, goals), [goals, tracks]);
  const indexItems = useMemo<GoalIndexItem[]>(
    () =>
      goals
        .filter((goal) => goal.status === "active")
        .map((goal) => {
          const overview = buildGoalOverview(goal, tasks, tracks, steps);
          const progress =
            overview.progress.kind === "project"
              ? { completed: overview.progress.completed, total: overview.progress.total }
              : { completed: overview.momentum.activeMemberCount, total: overview.progress.totalMembers };
          return {
            goalId: goal.id,
            title: goal.title,
            completed: progress.completed,
            total: progress.total,
            weekActiveMembers: overview.momentum.activeMemberCount,
          };
        }),
    [goals, steps, tasks, tracks],
  );
  const pinnedMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pin of layoutPins) {
      if (pin.nodeKind !== "goal") ids.add(`goal:${pin.goalId}|${pin.nodeKind}:${pin.nodeId}`);
    }
    return ids;
  }, [layoutPins]);
  const settleInput = useMemo(
    () =>
      buildGalaxySettleInput({
        model,
        seedPositions: layout.positions,
        boxes: layout.boxes,
        pinnedMemberIds,
        anchorCanvasById,
      }),
    [anchorCanvasById, layout.boxes, layout.positions, model, pinnedMemberIds],
  );
  const nodeCacheRef = useRef<Map<string, GoalGalaxyFlowNode>>(new Map());
  const layoutNodes = useMemo<GoalGalaxyFlowNode[]>(() => {
    const restoreAuto = (nodeId: string, anchorIds: string[]) => {
      void restoreGalaxyPin({ nodeId, anchorIds });
    };
    const starNodes = model.stars.map(
      (star) =>
        ({
          id: star.nodeId,
          type: "goal-star",
          position: layout.positions[star.nodeId] ?? { x: 0, y: 0 },
          draggable: true,
          selected: star.nodeId === selectedNodeId,
          data: {
            star,
            pinned: !settleEnabled && pinnedStarIds.has(star.nodeId),
            lively: settleEnabled,
            handles: <GalaxyStarHandles />,
            onRestoreAuto: () => restoreAuto(star.nodeId, []),
          },
        }) satisfies GoalGalaxyFlowNode,
    );
    const memberNodes = model.nodes.map((node) => {
      const pinned = !settleEnabled && node.anchorIds.length === 1 && pinnedMemberIds.has(`${node.anchorIds[0]}|${node.id}`);
      return {
        id: node.id,
        type: "goal-galaxy-member",
        position: layout.positions[node.id] ?? { x: 0, y: 0 },
        draggable: node.anchorIds.length === 1,
        selected: node.id === selectedNodeId,
        data: {
          node: toGraphNode(node),
          anchorIds: node.anchorIds,
          lod: node.lod,
          pinned,
          lively: settleEnabled,
          onRestoreAuto: () => restoreAuto(node.id, node.anchorIds),
        },
      } satisfies GoalGalaxyFlowNode;
    });
    const nextNodes = [...starNodes, ...memberNodes].map((node) => {
      const previous = nodeCacheRef.current.get(node.id);
      return canReuseGalaxyNode(previous, node) ? previous : node;
    });
    nodeCacheRef.current = new Map(nextNodes.map((node) => [node.id, node]));
    return nextNodes;
  }, [
    layout.positions,
    model.nodes,
    model.stars,
    pinnedMemberIds,
    pinnedStarIds,
    selectedNodeId,
    settleEnabled,
  ]);
  const [nodes, setNodes] = useState<GoalGalaxyFlowNode[]>(() => layoutNodes);
  const applySettlePositions = useCallback((positions: Record<string, XY>) => {
    setNodes((current) => {
      let changed = false;
      const nextNodes = current.map((node) => {
        const next = positions[node.id];
        if (!next || (next.x === node.position.x && next.y === node.position.y)) return node;
        changed = true;
        return { ...node, position: { x: next.x, y: next.y } };
      });
      return changed ? nextNodes : current;
    });
  }, []);
  const settle = useGalaxySettleEngine({
    enabled: settleEnabled,
    input: settleInput,
    live: liveSettle,
    onPositions: applySettlePositions,
  });
  const layoutPositionKeyValue = useMemo(() => layoutPositionKey(layoutNodes), [layoutNodes]);
  const lastLayoutPositionKeyRef = useRef<string | null>(null);
  const wasSettleEnabledRef = useRef(settleEnabled);

  useEffect(() => {
    const wasSettleEnabled = wasSettleEnabledRef.current;
    wasSettleEnabledRef.current = settleEnabled;
    if (settleEnabled) {
      setNodes((current) => mergeLayoutNodeDataKeepingPositions(current, layoutNodes));
      return;
    }
    const shouldResetPositions = lastLayoutPositionKeyRef.current !== layoutPositionKeyValue;
    lastLayoutPositionKeyRef.current = layoutPositionKeyValue;
    setNodes((current) => {
      const next =
        current.length === 0 || shouldResetPositions || wasSettleEnabled
          ? layoutNodes
          : mergeLayoutNodeDataKeepingPositions(current, layoutNodes);
      return next;
    });
  }, [layoutNodes, layoutPositionKeyValue, settleEnabled]);
  useEffect(() => {
    if (settleEnabled) setLiveSettle(true);
    else setSettleHint(null);
  }, [settleEnabled]);
  const edges = useMemo<GoalGalaxyFlowEdge[]>(() => {
    const handleBoxById = new Map<string, HandleBox>();
    for (const node of nodes) {
      const box = layout.boxes[node.id];
      if (!box) continue;
      handleBoxById.set(node.id, {
        x: node.position.x + (box.offsetX ?? 0),
        y: node.position.y + (box.offsetY ?? 0),
        width: box.width,
        height: box.height,
      });
    }
    const routings = computeEdgeRoutings(model.edges, handleBoxById);
    return model.edges.map((edge) => ({
      id: edge.id,
      type: "goal-graph-edge",
      source: edge.source,
      target: edge.target,
      sourceHandle: "source-center",
      targetHandle: "target-center",
      style: edge.kind === "tether" ? { opacity: tetherOpacity } : undefined,
      data: {
        kind: edge.kind,
        goalId: edge.goalId,
        opacity: edge.kind === "prerequisite" ? prereqOpacity : undefined,
        routing: routings.get(edge.id),
      },
      selected: edge.id === selectedEdgeId,
    }));
  }, [layout.boxes, model.edges, nodes, prereqOpacity, selectedEdgeId, tetherOpacity]);
  useEffect(() => {
    if (initialFitGoalKey === activeGoalKey) return;
    if (activeGoalCount === 0) return;
    if (Object.keys(lodByGoalId).length < activeGoalCount) return;
    if (nodes.length < model.stars.length + model.nodes.length) return;
    void flow.fitView({ padding: 0.2 });
    setInitialFitGoalKey(activeGoalKey);
  }, [
    activeGoalCount,
    activeGoalKey,
    flow,
    initialFitGoalKey,
    lodByGoalId,
    model.nodes.length,
    model.stars.length,
    nodes.length,
  ]);

  const onNodeDoubleClick = useCallback<NodeMouseHandler<GoalGalaxyFlowNode>>(
    (_event, node) => {
      const goalId = goalIdFromStarNodeId(node.id);
      if (!goalId) return;
      onNavigate(`/goals/${goalId}`);
    },
    [onNavigate],
  );

  function handleNodeClick(node: GoalGalaxyFlowNode): void {
    if (connectDraft) {
      void connectToTarget(node);
      return;
    }
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setErrorMessage(null);
  }

  const onEdgeClick = useCallback<EdgeMouseHandler<GoalGalaxyFlowEdge>>((_event, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setConnectDraft(null);
    setErrorMessage(null);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<GoalGalaxyFlowNode>[]) => {
      const settlePins: Array<{ id: string; position: XY }> = [];
      setNodes((current) => applyGalaxyNodeChanges(current, changes));
      if (settleEnabled) {
        const currentById = new Map(nodes.map((node) => [node.id, node]));
        for (const change of changes) {
          if (change.type !== "position" || !("id" in change) || !change.position) continue;
          settlePins.push({ id: change.id, position: change.position });
          const movedNode = currentById.get(change.id);
          if (movedNode?.type !== "goal-star") continue;
          const delta = {
            x: change.position.x - movedNode.position.x,
            y: change.position.y - movedNode.position.y,
          };
          for (const node of nodes) {
            if (node.type === "goal-galaxy-member" && node.data.anchorIds.includes(change.id)) {
              const factor = 1 / Math.max(1, node.data.anchorIds.length);
              settlePins.push({ id: node.id, position: translate(node.position, delta, factor) });
            }
          }
        }
        for (const pin of settlePins) settle.setDragPin(pin.id, pin.position);
      }
    },
    [nodes, settle, settleEnabled],
  );

  function handleNodeDragStop(node: GoalGalaxyFlowNode): void {
    if (settleEnabled) {
      settle.setDragPin(node.id, null);
      setSettleHint("灵动模式不保存位置，切回静态模式后恢复布局");
      if (node.type === "goal-star") {
        for (const currentNode of nodes) {
          if (currentNode.type === "goal-galaxy-member" && currentNode.data.anchorIds.includes(node.id)) {
            settle.setDragPin(currentNode.id, null);
          }
        }
      }
      return;
    }
    const finalPosition = node.position;
    const anchorIds = anchorIdsForFlowNode(node);
    const ref = galaxyPinRef(node.id, goalIdsFromAnchorIds(anchorIds));
    if (!ref) return;

    if (ref.nodeKind === "goal") {
      const coords = goalPinFromCanvas(finalPosition);
      void upsertGoalLayoutPin({ ...ref, x: coords.x, y: coords.y });
      return;
    }

    const starNodeId = `goal:${ref.goalId}`;
    const anchor =
      nodes.find((candidate) => candidate.id === starNodeId)?.position ??
      layout.positions[starNodeId] ??
      anchorCanvasById[starNodeId] ??
      { x: 0, y: 0 };
    const coords = memberPinFromCanvas(finalPosition, anchor);
    void upsertGoalLayoutPin({ ...ref, x: coords.x, y: coords.y });
  }

  function handleMoveEnd(_event: MouseEvent | TouchEvent | null, nextViewport: Viewport): void {
    setViewport(nextViewport);
  }

  function fitGalaxyView(): void {
    void flow.fitView({ padding: 0.2 });
  }

  const focusGoalStar = useCallback(
    (goalId: string): void => {
      const starId = `goal:${goalId}`;
      const focusNodes = [
        { id: starId },
        ...nodes
          .filter((node) => node.type === "goal-galaxy-member" && node.data.anchorIds.includes(starId))
          .map((node) => ({ id: node.id })),
      ];
      void flow.fitView({ nodes: focusNodes, padding: 0.35, duration: 300 });
    },
    [flow, nodes],
  );

  const onGalaxyDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (isGalaxyOverlayTarget(event.target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onGalaxyDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (isGalaxyOverlayTarget(event.target)) return;
      event.preventDefault();
      const ref = readDragRef(event.dataTransfer);
      if (!ref) return;

      const flowPos = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const positionByNodeId = new Map(nodes.map((node) => [node.id, node.position]));
      const stars: GoalStarHitTarget[] = model.stars.map((star) => {
        const measured = flow.getNode(star.nodeId)?.measured;
        return {
          goalId: star.goalId,
          center: positionByNodeId.get(star.nodeId) ?? layout.positions[star.nodeId] ?? { x: 0, y: 0 },
          width: measured?.width ?? STAR_HIT_FALLBACK.width,
          height: measured?.height ?? STAR_HIT_FALLBACK.height,
        };
      });
      const goalId = hitTestGoalStar(flowPos, stars);
      if (!goalId) return;

      event.dataTransfer.dropEffect = "copy";
      void addGoalMember(goalId, ref);
    },
    [flow, layout.positions, model.stars, nodes],
  );

  function handleLineOpacityChange(value: string): void {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    if (opacityTarget === "tether") {
      setTetherOpacity(Math.min(TETHER_OPACITY_MAX, Math.max(TETHER_OPACITY_MIN, next / 100)));
      return;
    }
    setPrereqOpacity(Math.min(PREREQUISITE_OPACITY_MAX, Math.max(PREREQUISITE_OPACITY_MIN, next / 100)));
  }

  async function writePrerequisite(goalId: string, blocker: GoalMemberRef, blocked: GoalMemberRef): Promise<void> {
    const goal = goalById.get(goalId);
    if (!goal) return;

    const validation = validatePrerequisiteEdge(goal, blocker, blocked);
    if (!validation.ok && validation.error) {
      setErrorMessage(REASON_COPY[validation.error]);
      setConnectDraft(null);
      return;
    }

    await updateGoalPrerequisites(goal.id, nextPrerequisitesWithEdge(goal, blocker, blocked));
    setConnectDraft(null);
    setErrorMessage(null);
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
    const actions = actionsForNode(selectedGraphNode, {
      pinned: selectedFlowNode.data.pinned === true,
    });
    return selectedGraphNode.kind === "goal" ? [ADD_MEMBER_ACTION, ...actions] : actions;
  }, [selectedFlowNode, selectedGraphNode]);
  const selectedGraphEdge = useMemo<GoalGraphEdge | null>(() => {
    if (!selectedEdgeId) return null;
    const edge = model.edges.find((item) => item.id === selectedEdgeId);
    return edge ? { id: edge.id, kind: edge.kind, source: edge.source, target: edge.target } : null;
  }, [model.edges, selectedEdgeId]);
  const selectedEdgeActions = useMemo(
    () => (selectedGraphEdge ? actionsForEdge(selectedGraphEdge) : []),
    [selectedGraphEdge],
  );
  const selectedFlowEdge = useMemo(
    () => (selectedEdgeId ? (edges.find((edge) => edge.id === selectedEdgeId) ?? null) : null),
    [edges, selectedEdgeId],
  );

  function clearSelection(): void {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectDraft(null);
  }

  function owningGoalIdsForNode(node: GoalGalaxyFlowNode): string[] {
    return node.type === "goal-galaxy-member" ? goalIdsFromAnchorIds(node.data.anchorIds) : [];
  }

  function runNodeAction(action: GoalAction): void {
    if (!selectedFlowNode || !selectedGraphNode) return;
    if (action.id === "add-member") {
      const goalId = goalIdFromStarNodeId(selectedFlowNode.id);
      if (goalId) setAddMemberGoalId(goalId);
      return;
    }
    if (action.id === "edit-goal") {
      const goalId = goalIdFromStarNodeId(selectedFlowNode.id);
      if (goalId) setGoalMenuGoalId(goalId);
      return;
    }
    if (action.id === "toggle-archive") {
      const goalId = goalIdFromStarNodeId(selectedFlowNode.id);
      const goal = goalId ? goalById.get(goalId) : null;
      if (!goalId || !goal) return;
      void updateGoal(goalId, { status: goal.status === "archived" ? "active" : "archived" });
      return;
    }
    if (action.id === "delete-goal") {
      const goalId = goalIdFromStarNodeId(selectedFlowNode.id);
      if (goalId) setGoalMenuGoalId(goalId);
      return;
    }
    if (action.id === "open" && selectedGraphNode.ref?.kind === "task") {
      onNavigate(`/todo?taskId=${selectedGraphNode.ref.id}`);
      return;
    }
    if (action.id === "open" && selectedGraphNode.ref?.kind === "track") {
      onNavigate(`/tracks/${selectedGraphNode.ref.id}`);
      return;
    }
    if (action.id === "toggle-complete" && selectedGraphNode.ref?.kind === "task") {
      void toggleTaskDone(selectedGraphNode.ref.id);
      return;
    }
    if (action.id === "connect") {
      const ref = refFromGraphNode(selectedGraphNode);
      const owningGoalIds = owningGoalIdsForNode(selectedFlowNode);
      if (!ref) return;
      if (owningGoalIds.length !== 1) {
        setBridgeRouteChoice({ goalIds: owningGoalIds, nodeTitle: selectedGraphNode.title });
        return;
      }
      setConnectDraft({ goalId: owningGoalIds[0], node: selectedGraphNode });
      setErrorMessage(null);
      return;
    }
    if (action.id === "restore-auto") {
      void restoreGalaxyPin({
        nodeId: selectedFlowNode.id,
        anchorIds: anchorIdsForFlowNode(selectedFlowNode),
      });
      return;
    }
    if (action.id === "remove-member") {
      const ref = selectedGraphNode.ref;
      const owningGoalIds = owningGoalIdsForNode(selectedFlowNode);
      if (!ref) return;
      if (owningGoalIds.length !== 1) {
        setBridgeRouteChoice({ goalIds: owningGoalIds, nodeTitle: selectedGraphNode.title });
        return;
      }
      setPendingRemoveMember({ goalId: owningGoalIds[0], node: selectedGraphNode });
    }
  }

  function navigateBridgeGoal(goalId: string): void {
    setBridgeRouteChoice(null);
    onNavigate(`/goals/${goalId}`);
  }

  async function connectToTarget(targetFlowNode: GoalGalaxyFlowNode): Promise<void> {
    if (!connectDraft || targetFlowNode.type !== "goal-galaxy-member") return;
    const blocker = refFromGraphNode(connectDraft.node);
    const blocked = refFromGraphNode(targetFlowNode.data.node);
    if (!blocker || !blocked) return;

    await writePrerequisite(connectDraft.goalId, blocker, blocked);
    setSelectedNodeId(targetFlowNode.id);
  }

  async function handleConnect(connection: Connection): Promise<void> {
    if (!connection.source || !connection.target) return;
    const blocker = refFromNodeId(connection.source);
    const blocked = refFromNodeId(connection.target);
    if (!blocker || !blocked) {
      setErrorMessage(REASON_COPY["goal-anchor"]);
      return;
    }

    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    const sharedGoalIds = commonGoalIds(sourceNode, targetNode);
    if (sharedGoalIds.length === 0) {
      setErrorMessage(REASON_COPY["non-member"]);
      return;
    }
    if (sharedGoalIds.length > 1) {
      setBridgeRouteChoice({ goalIds: sharedGoalIds, nodeTitle: "这条前置关系" });
      return;
    }

    await writePrerequisite(sharedGoalIds[0], blocker, blocked);
    setSelectedEdgeId(null);
    setSelectedNodeId(connection.target);
  }

  async function confirmRemoveMember(): Promise<void> {
    const pending = pendingRemoveMember;
    const ref = pending?.node.ref;
    if (!pending || !ref) return;

    await removeGoalMember(pending.goalId, ref);
    setPendingRemoveMember(null);
  }

  const addMemberGoal = addMemberGoalId ? (goalById.get(addMemberGoalId) ?? null) : null;
  const goalMenuGoal = goalMenuGoalId ? (goalById.get(goalMenuGoalId) ?? null) : null;

  async function addMember(ref: GoalMemberRef): Promise<void> {
    if (!addMemberGoalId) return;
    await addGoalMember(addMemberGoalId, ref);
  }

  async function quickCreateTask(title: string): Promise<void> {
    if (!addMemberGoalId) return;
    await addTaskForGoal(addMemberGoalId, { title, toInbox: destination === "inbox" });
  }

  async function saveGoalMenu(patch: GoalEditPatch): Promise<void> {
    if (!goalMenuGoalId) return;
    await updateGoal(goalMenuGoalId, patch);
  }

  async function toggleGoalArchive(): Promise<void> {
    if (!goalMenuGoal) return;
    await updateGoal(goalMenuGoal.id, { status: goalMenuGoal.status === "archived" ? "active" : "archived" });
  }

  async function deleteGoalFromMenu(): Promise<void> {
    if (!goalMenuGoalId) return;
    await deleteGoal(goalMenuGoalId);
    setSelectedNodeId(null);
    setGoalMenuGoalId(null);
  }

  const opacityPercent = Math.round((opacityTarget === "tether" ? tetherOpacity : prereqOpacity) * 100);
  const opacityMax = opacityTarget === "tether" ? 50 : 100;

  async function runEdgeAction(action: GoalAction): Promise<void> {
    const edgeGoalId = selectedFlowEdge?.data?.goalId;
    if (action.id !== "delete-prerequisite" || !selectedGraphEdge || !edgeGoalId) return;
    const blocker = refFromNodeId(selectedGraphEdge.source);
    const blocked = refFromNodeId(selectedGraphEdge.target);
    if (!blocker || !blocked) return;
    const goal = goalById.get(edgeGoalId);
    if (!goal) return;

    await updateGoalPrerequisites(goal.id, nextPrerequisitesWithoutEdge(goal, blocker, blocked));
    setSelectedEdgeId(null);
  }

  return (
    <div
      data-galaxy
      onDragOver={onGalaxyDragOver}
      onDrop={onGalaxyDrop}
      className="relative h-full min-h-[520px] overflow-hidden bg-page text-ink"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        nodeOrigin={[0.5, 0.5]}
        proOptions={{ hideAttribution: true }}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => handleNodeClick(node)}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStop={(_event, node) => handleNodeDragStop(node)}
        onEdgeClick={onEdgeClick}
        onConnect={(connection) => void handleConnect(connection)}
        onPaneClick={clearSelection}
        onMoveEnd={handleMoveEnd}
        className="h-full w-full"
      >
        <Background />
      </ReactFlow>
      {wide && indexOpen && (
        <aside
          aria-label="目标索引"
          data-drawer="index"
          className="absolute left-0 top-0 z-20 h-full w-72 border-r border-border bg-surface-elevated shadow-elev2"
        >
          <GoalIndexPanel items={indexItems} onFocus={focusGoalStar} />
        </aside>
      )}
      {wide && trayOpen && (
        <ResizableTrayAside>
          <GoalUnassignedTray tasks={trayTasks} tracks={trayTracks} steps={steps} boardSignals={boardSignals} />
        </ResizableTrayAside>
      )}
      <div
        data-galaxy-controls
        className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2"
      >
        <GoalGalaxyHud rollup={rollup} />
        {wide && (
          <>
            <button
              type="button"
              aria-label="目标"
              aria-pressed={indexOpen}
              onClick={() => setIndexOpen((value) => !value)}
              className={CONTROL_PILL_CLASS}
            >
              目标
            </button>
            <button
              type="button"
              aria-label="未归类"
              aria-pressed={trayOpen}
              onClick={() => setTrayOpen((value) => !value)}
              className={CONTROL_PILL_CLASS}
            >
              未归类({trayTasks.length + trayTracks.length})
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="回到全图"
          onClick={fitGalaxyView}
          className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface-elevated text-ink-2 shadow-sm transition-colors hover:bg-surface-hover hover:text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <Icon icon={CornersOut} size={16} />
        </button>
        <div className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-pill border border-border bg-surface-elevated px-2 text-xs text-ink-2 shadow-sm">
          <div className="inline-flex overflow-hidden rounded-pill border border-border bg-surface">
            <button
              type="button"
              aria-label="归属线透明度"
              aria-pressed={opacityTarget === "tether"}
              onClick={() => setOpacityTarget("tether")}
              className="h-6 px-2 text-xs transition-colors aria-pressed:bg-accent aria-pressed:text-page"
            >
              归属线
            </button>
            <button
              type="button"
              aria-label="连接线透明度"
              aria-pressed={opacityTarget === "prerequisite"}
              onClick={() => setOpacityTarget("prerequisite")}
              className="h-6 px-2 text-xs transition-colors aria-pressed:bg-accent aria-pressed:text-page"
            >
              连接线
            </button>
          </div>
          <input
            type="range"
            aria-label="星图线透明度"
            min="0"
            max={opacityMax}
            step="1"
            value={opacityPercent}
            onInput={(event) => handleLineOpacityChange(event.currentTarget.value)}
            className="h-1 w-24 accent-accent"
          />
          <span className="w-8 text-right tabular-nums">{opacityPercent}%</span>
        </div>
        <GoalGalaxyEngineToggle
          live={liveSettle}
          mode={engineMode}
          onModeChange={setEngineMode}
          onLiveChange={setLiveSettle}
        />
      </div>
      <GoalGalaxyActionBar
        node={selectedGraphNode}
        actions={selectedNodeActions}
        onAction={runNodeAction}
        onClose={clearSelection}
      />
      <GoalGalaxyEdgeActionBar
        actions={selectedEdgeActions}
        onAction={(action) => void runEdgeAction(action)}
        onClose={clearSelection}
      />
      {errorMessage && (
        <div className="absolute bottom-3 right-3 z-10 rounded-card border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorMessage}
        </div>
      )}
      {settleHint && !errorMessage && (
        <div className="td-text-body absolute bottom-3 right-3 z-10 rounded-card border border-border bg-surface px-3 py-2 text-ink-2">
          {settleHint}
        </div>
      )}
      <ConfirmSheet
        open={pendingRemoveMember !== null}
        title="移除成员"
        body={pendingRemoveMember ? `将从目标中移除「${pendingRemoveMember.node.title}」。` : ""}
        confirmLabel="移除成员"
        cancelLabel="取消"
        danger
        onCancel={() => setPendingRemoveMember(null)}
        onConfirm={() => void confirmRemoveMember()}
      />
      <GoalAddMemberSheet
        open={addMemberGoal !== null}
        tasks={tasks}
        tracks={tracks}
        steps={steps}
        members={addMemberGoal?.members ?? []}
        boardSignals={boardSignals}
        archived={addMemberGoal?.status === "archived"}
        onAddMember={(ref) => void addMember(ref)}
        onQuickCreateTask={(title) => void quickCreateTask(title)}
        onClose={() => setAddMemberGoalId(null)}
      />
      {goalMenuGoal && (
        <GoalEditSheet
          open
          goal={goalMenuGoal}
          onSave={(patch) => void saveGoalMenu(patch)}
          onToggleArchive={() => void toggleGoalArchive()}
          onDelete={() => void deleteGoalFromMenu()}
          onClose={() => setGoalMenuGoalId(null)}
        />
      )}
      <Sheet open={bridgeRouteChoice !== null} onClose={() => setBridgeRouteChoice(null)} title="选择目标">
        <div className="grid gap-2 px-4 pb-4">
          {bridgeRouteChoice?.goalIds.map((goalId) => {
            const goal = goalById.get(goalId);
            const title = goal?.title ?? goalId;
            return (
              <button
                key={goalId}
                type="button"
                aria-label={`在 ${title} 中编辑`}
                onClick={() => navigateBridgeGoal(goalId)}
                className="min-h-11 rounded-ctl border border-border px-3 text-left text-sm text-ink"
              >
                {title}
              </button>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
