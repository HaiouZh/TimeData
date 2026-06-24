import "@xyflow/react/dist/style.css";

import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import type { Goal, GoalMemberRef, GoalPrerequisite, Task, Track, TrackStep } from "@timedata/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "../../components/ui/Sheet.js";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { addPrerequisiteEdge, removePrerequisiteEdge, validatePrerequisiteEdge } from "../../lib/goalGraphEdges.js";
import { goalGraphLayout, type GoalGraphLayout, type GoalGraphOrientation } from "../../lib/goalGraphLayout.js";
import { buildGoalGraphModel, type GoalGraphEdge as GoalGraphEdgeModel, type GoalGraphNode as GoalGraphNodeModel } from "../../lib/goalGraphModel.js";
import { loadGoalGraphViewport, saveGoalGraphViewport } from "../../lib/goalGraphViewport.js";
import {
  addGoalMember,
  addTaskForGoal,
  deleteGoal,
  removeGoalMember,
  updateGoal,
  updateGoalPrerequisites,
} from "../../lib/goals.js";
import { buildGoalOverview } from "../../lib/goalsView.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { useTodoDefaultDestination } from "../../lib/settings/todoDefaultDestinationSetting.js";
import { toggleTaskDone } from "../../lib/tasks.js";
import { useIsCoarsePointer } from "../../lib/useIsCoarsePointer.js";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { actionsForEdge, actionsForNode, type GoalAction, type GoalActionId } from "./goalGraphActions.js";
import { GoalEditForm } from "./GoalEditForm.js";
import { GoalAddMemberSheet } from "./GoalAddMemberSheet.js";
import { GoalEditSheet } from "./GoalEditSheet.js";
import { GoalMemberPicker } from "./GoalMemberPicker.js";
import { GoalGraphEdge, type GoalGraphFlowEdge } from "./GoalGraphEdge.js";
import { GoalGraphNode, type GoalGraphFlowNode } from "./GoalGraphNode.js";
import { GoalGraphToolbar } from "./GoalGraphToolbar.js";
import { GoalGraphUndoToast } from "./GoalGraphUndoToast.js";
import { GoalSidePanel } from "./GoalSidePanel.js";

const REASON_COPY = {
  "self-reference": "不能连接自己",
  duplicate: "这条前置已存在",
  cycle: "会形成循环前置",
  "goal-anchor": "Goal 锚不参与前置",
  "non-member": "只能连当前目标里的有效成员",
} as const;

const nodeTypes = { "goal-graph-node": GoalGraphNode };
const edgeTypes = { "goal-graph-edge": GoalGraphEdge };

export interface GoalGraphEditorProps {
  goal: Goal;
  tasks: Task[];
  tracks: Track[];
  steps: TrackStep[];
  onNavigate: (to: string) => void;
  onDeletedGoal: () => void;
}

interface UndoState {
  message: string;
  onUndo: () => Promise<void>;
}

interface ConnectDraft {
  node: GoalGraphNodeModel;
  direction: "from-current" | "to-current" | null;
}

type GraphGoalLike = Pick<Goal, "members" | "prerequisites">;

interface LayoutCache {
  key: string;
  orientation: GoalGraphOrientation;
  layout: GoalGraphLayout;
}

type WidePanel = "add-member" | "goal-menu" | null;

function refFromNodeId(id: string): GoalMemberRef | null {
  const clean = id.startsWith("ghost:") ? id.slice(6) : id;
  const separator = clean.indexOf(":");
  if (separator < 0) return null;
  const kind = clean.slice(0, separator);
  const refId = clean.slice(separator + 1);
  if (kind !== "task" && kind !== "track") return null;
  return { kind, id: refId };
}

function edgeRefs(edge: GoalGraphEdgeModel): { blocker: GoalMemberRef; blocked: GoalMemberRef } | null {
  const blocker = refFromNodeId(edge.source);
  const blocked = refFromNodeId(edge.target);
  return blocker && blocked ? { blocker, blocked } : null;
}

function nextPrerequisitesWithEdge(goal: GraphGoalLike, blocker: GoalMemberRef, blocked: GoalMemberRef): GoalPrerequisite[] {
  return addPrerequisiteEdge(goal, blocker, blocked).prerequisites;
}

function nextPrerequisitesWithoutEdge(goal: GraphGoalLike, blocker: GoalMemberRef, blocked: GoalMemberRef): GoalPrerequisite[] {
  return removePrerequisiteEdge(goal, blocker, blocked).prerequisites;
}

function isRealMemberNode(node: GoalGraphNodeModel): boolean {
  return node.kind === "task" || node.kind === "track";
}

function actionLabel(action: GoalAction, node: GoalGraphNodeModel): string {
  return `${action.label} ${node.title}`;
}

export function GoalGraphEditor(props: GoalGraphEditorProps) {
  return (
    <ReactFlowProvider>
      <GoalGraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function GoalGraphEditorInner({ goal, tasks, tracks, steps, onNavigate, onDeletedGoal }: GoalGraphEditorProps) {
  const destination = useTodoDefaultDestination();
  const boardSignals = useTrackActionTags();
  const wide = useIsWideScreen();
  const coarse = useIsCoarsePointer();
  const orientation: GoalGraphOrientation = wide ? "horizontal" : "vertical";
  const inlineActions = wide && !coarse;
  const { syncAfterWrite } = useSyncContext();
  const flow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [goalMenuOpen, setGoalMenuOpen] = useState(false);
  const [widePanel, setWidePanel] = useState<WidePanel>(null);
  const [connectDraft, setConnectDraft] = useState<ConnectDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const layoutCacheRef = useRef<LayoutCache | null>(null);
  const initialFitDoneRef = useRef<string | null>(null);
  const savedViewport = loadGoalGraphViewport(goal.id);

  const overview = useMemo(() => buildGoalOverview(goal, tasks, tracks, steps), [goal, steps, tasks, tracks]);
  const model = useMemo(() => buildGoalGraphModel(overview), [overview]);
  const structureKey = useMemo(
    () => `${model.nodes.map((node) => node.id).join("|")}#${model.edges.map((edge) => edge.id).join("|")}`,
    [model],
  );
  const cachedLayout = layoutCacheRef.current;
  const layout =
    cachedLayout?.key === structureKey && cachedLayout.orientation === orientation
      ? cachedLayout.layout
      : goalGraphLayout(model, { orientation });
  layoutCacheRef.current = { key: structureKey, orientation, layout };
  const nodes = useMemo<GoalGraphFlowNode[]>(
    () =>
      model.nodes.map((node) => ({
        id: node.id,
        type: "goal-graph-node",
        position: layout.positions[node.id] ?? { x: 0, y: 0 },
        data: { node, orientation },
        selected: node.id === selectedNodeId,
      })),
    [layout.positions, model.nodes, orientation, selectedNodeId],
  );
  const edges = useMemo<GoalGraphFlowEdge[]>(
    () =>
      model.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "goal-graph-edge",
        data: { kind: edge.kind },
        selected: edge.id === selectedEdgeId,
      })),
    [model.edges, selectedEdgeId],
  );
  const selectedNode = selectedNodeId ? (model.nodes.find((node) => node.id === selectedNodeId) ?? null) : null;
  const selectedEdge = selectedEdgeId ? (model.edges.find((edge) => edge.id === selectedEdgeId) ?? null) : null;

  useEffect(() => {
    if (savedViewport) return;
    if (!nodesInitialized) return;
    if (model.nodes.length === 0) return;
    if (initialFitDoneRef.current === goal.id) return;
    initialFitDoneRef.current = goal.id;
    void flow.fitView({ padding: 0.25 });
  }, [flow, goal.id, model.nodes.length, nodesInitialized, savedViewport]);

  function clearSelection(): void {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectDraft(null);
  }

  const onNodeClick: NodeMouseHandler<GoalGraphFlowNode> = (_event, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setErrorMessage(null);
  };

  const onEdgeClick: EdgeMouseHandler<GoalGraphFlowEdge> = (_event, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setErrorMessage(null);
  };

  async function writePrerequisite(blocker: GoalMemberRef, blocked: GoalMemberRef): Promise<void> {
    const validation = validatePrerequisiteEdge(goal, blocker, blocked);
    if (!validation.ok && validation.error) {
      setErrorMessage(REASON_COPY[validation.error]);
      return;
    }

    await updateGoalPrerequisites(goal.id, nextPrerequisitesWithEdge(goal, blocker, blocked));
    syncAfterWrite();
    setErrorMessage(null);
    setConnectDraft(null);
  }

  async function removeSelectedMember(node: GoalGraphNodeModel): Promise<void> {
    const ref = node.ref ?? refFromNodeId(node.id);
    if (!ref) return;
    const previousMembers = [...(goal.members ?? [])];
    const previousPrerequisites = goal.prerequisites ?? [];
    await removeGoalMember(goal.id, ref);
    syncAfterWrite();
    setUndo({
      message: "已移出成员",
      onUndo: async () => {
        await updateGoal(goal.id, { members: previousMembers, prerequisites: previousPrerequisites });
        syncAfterWrite();
      },
    });
  }

  async function runNodeAction(actionId: GoalActionId, node: GoalGraphNodeModel): Promise<void> {
    const ref = node.ref ?? refFromNodeId(node.id);

    if (actionId === "open" && ref?.kind === "task") {
      onNavigate(`/todo?taskId=${ref.id}`);
      return;
    }
    if (actionId === "open" && ref?.kind === "track") {
      onNavigate(`/tracks/${ref.id}`);
      return;
    }
    if (actionId === "toggle-complete" && ref?.kind === "task") {
      await toggleTaskDone(ref.id);
      syncAfterWrite();
      return;
    }
    if (actionId === "connect") {
      setConnectDraft({ node, direction: null });
      return;
    }
    if (actionId === "remove-member" || actionId === "remove-ref") {
      await removeSelectedMember(node);
      return;
    }
    if (actionId === "edit-goal") {
      if (wide) setWidePanel("goal-menu");
      else setGoalMenuOpen(true);
      return;
    }
    if (actionId === "toggle-archive") {
      await updateGoal(goal.id, { status: goal.status === "archived" ? "active" : "archived" });
      syncAfterWrite();
      return;
    }
    if (actionId === "delete-goal") {
      await deleteGoal(goal.id);
      syncAfterWrite();
      onDeletedGoal();
    }
  }

  async function runEdgeAction(edge: GoalGraphEdgeModel): Promise<void> {
    const refs = edgeRefs(edge);
    if (!refs) return;
    const previousPrerequisites = goal.prerequisites ?? [];
    await updateGoalPrerequisites(goal.id, nextPrerequisitesWithoutEdge(goal, refs.blocker, refs.blocked));
    syncAfterWrite();
    setUndo({
      message: "已删除前置",
      onUndo: async () => {
        await updateGoalPrerequisites(goal.id, previousPrerequisites);
        syncAfterWrite();
      },
    });
  }

  async function connectToTarget(target: GoalGraphNodeModel): Promise<void> {
    if (!connectDraft?.direction) return;
    const current = connectDraft.node.ref ?? refFromNodeId(connectDraft.node.id);
    const other = target.ref ?? refFromNodeId(target.id);
    if (!current || !other) return;
    const blocker = connectDraft.direction === "from-current" ? current : other;
    const blocked = connectDraft.direction === "from-current" ? other : current;
    await writePrerequisite(blocker, blocked);
  }

  async function handleConnect(connection: Connection): Promise<void> {
    if (!connection.source || !connection.target) return;
    const blocker = refFromNodeId(connection.source);
    const blocked = refFromNodeId(connection.target);
    if (!blocker || !blocked) {
      setErrorMessage(REASON_COPY["non-member"]);
      return;
    }
    await writePrerequisite(blocker, blocked);
  }

  async function addMember(ref: GoalMemberRef): Promise<void> {
    await addGoalMember(goal.id, ref);
    syncAfterWrite();
  }

  async function quickCreateTask(title: string): Promise<void> {
    await addTaskForGoal(goal.id, { title, toInbox: destination === "inbox" });
    syncAfterWrite();
  }

  function handleMoveEnd(_event: MouseEvent | TouchEvent | null, viewport: Viewport): void {
    saveGoalGraphViewport(goal.id, viewport);
  }

  function fitView(): void {
    void flow.fitView({ padding: 0.2 });
  }

  return (
    <div data-goal-graph-editor className="relative flex h-full min-h-0 overflow-hidden bg-page">
      <div data-goal-graph-canvas className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={savedViewport ?? undefined}
          nodesDraggable={false}
          nodeOrigin={[0.5, 0.5]}
          proOptions={{ hideAttribution: true }}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={clearSelection}
          onConnect={(connection) => void handleConnect(connection)}
          onMoveEnd={handleMoveEnd}
          className="h-full w-full [&_.react-flow__node]:transition-transform motion-reduce:[&_.react-flow__node]:transition-none"
        >
          <Background />
        </ReactFlow>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <GoalGraphToolbar
          summary={model.summary}
          onAddMember={() => (wide ? setWidePanel("add-member") : setAddMemberOpen(true))}
          onFitView={fitView}
          onOpenGoalMenu={() => (wide ? setWidePanel("goal-menu") : setGoalMenuOpen(true))}
        />
      </div>

      {inlineActions && selectedNode && (
        <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 rounded-card border border-border bg-surface-elevated p-2 shadow-elev1">
          {actionsForNode(selectedNode, { archived: goal.status === "archived" }).map((action) => (
            <button
              key={action.id}
              type="button"
              aria-label={actionLabel(action, selectedNode)}
              onClick={() => void runNodeAction(action.id, selectedNode)}
              className={`min-h-9 rounded-ctl px-3 text-sm ${
                action.tone === "danger" ? "text-danger" : action.tone === "primary" ? "bg-accent text-page" : "text-ink"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {inlineActions && selectedEdge && (
        <div className="absolute bottom-3 left-3 z-10 flex gap-2 rounded-card border border-border bg-surface-elevated p-2 shadow-elev1">
          {actionsForEdge(selectedEdge).map((action) => (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              onClick={() => void runEdgeAction(selectedEdge)}
              className="min-h-9 rounded-ctl px-3 text-sm text-danger"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <Sheet open={!inlineActions && Boolean(selectedNode)} onClose={clearSelection} title={selectedNode?.title ?? "节点操作"}>
        <ActionList
          actions={selectedNode ? actionsForNode(selectedNode, { archived: goal.status === "archived" }) : []}
          labelFor={(action) => (selectedNode ? actionLabel(action, selectedNode) : action.label)}
          onAction={(action) => {
            if (selectedNode) void runNodeAction(action.id, selectedNode);
          }}
        />
      </Sheet>

      <Sheet open={!inlineActions && Boolean(selectedEdge)} onClose={clearSelection} title="前置关系">
        <ActionList
          actions={selectedEdge ? actionsForEdge(selectedEdge) : []}
          labelFor={(action) => action.label}
          onAction={() => {
            if (selectedEdge) void runEdgeAction(selectedEdge);
          }}
        />
      </Sheet>

      <ConnectSheet
        open={Boolean(connectDraft)}
        draft={connectDraft}
        nodes={model.nodes}
        onClose={() => setConnectDraft(null)}
        onDirection={(direction) => setConnectDraft((draft) => (draft ? { ...draft, direction } : draft))}
        onTarget={(node) => void connectToTarget(node)}
      />

      {errorMessage && (
        <div className="absolute bottom-3 right-3 z-10 rounded-card border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorMessage}
        </div>
      )}

      <GoalAddMemberSheet
        open={addMemberOpen}
        tasks={tasks}
        tracks={tracks}
        steps={steps}
        members={goal.members ?? []}
        boardSignals={boardSignals}
        archived={goal.status === "archived"}
        onAddMember={(ref) => void addMember(ref)}
        onQuickCreateTask={(title) => quickCreateTask(title)}
        onClose={() => setAddMemberOpen(false)}
      />
      <GoalSidePanel open={widePanel === "add-member"} title="添加成员" onClose={() => setWidePanel(null)}>
        <GoalMemberPicker
          tasks={tasks}
          tracks={tracks}
          steps={steps}
          members={goal.members ?? []}
          boardSignals={boardSignals}
          archived={goal.status === "archived"}
          onAddMember={(ref) => void addMember(ref)}
          onQuickCreateTask={(title) => quickCreateTask(title)}
        />
      </GoalSidePanel>
      <GoalSidePanel open={widePanel === "goal-menu"} title="目标设置" onClose={() => setWidePanel(null)}>
        <GoalEditForm
          goal={goal}
          active={widePanel === "goal-menu"}
          onSave={(patch) => {
            void updateGoal(goal.id, patch).then(syncAfterWrite);
          }}
          onToggleArchive={() => {
            void updateGoal(goal.id, { status: goal.status === "archived" ? "active" : "archived" }).then(syncAfterWrite);
          }}
          onDelete={() => {
            void deleteGoal(goal.id).then(() => {
              syncAfterWrite();
              onDeletedGoal();
            });
          }}
        />
      </GoalSidePanel>
      <GoalEditSheet
        open={goalMenuOpen}
        goal={goal}
        onSave={(patch) => {
          void updateGoal(goal.id, patch).then(syncAfterWrite);
        }}
        onToggleArchive={() => {
          void updateGoal(goal.id, { status: goal.status === "archived" ? "active" : "archived" }).then(syncAfterWrite);
        }}
        onDelete={() => {
          void deleteGoal(goal.id).then(() => {
            syncAfterWrite();
            onDeletedGoal();
          });
        }}
        onClose={() => setGoalMenuOpen(false)}
      />
      <GoalGraphUndoToast
        open={Boolean(undo)}
        message={undo?.message ?? ""}
        actionLabel="撤销"
        onAction={() => {
          const undoAction = undo?.onUndo;
          setUndo(null);
          if (undoAction) void undoAction();
        }}
        onDismiss={() => setUndo(null)}
      />
    </div>
  );
}

function ActionList({
  actions,
  labelFor,
  onAction,
}: {
  actions: GoalAction[];
  labelFor: (action: GoalAction) => string;
  onAction: (action: GoalAction) => void;
}) {
  return (
    <div className="grid gap-2 px-4 pb-4">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          aria-label={labelFor(action)}
          onClick={() => onAction(action)}
          className={`min-h-11 rounded-ctl border px-3 text-sm ${
            action.tone === "danger"
              ? "border-danger/40 text-danger"
              : action.tone === "primary"
                ? "border-accent bg-accent text-page"
                : "border-border text-ink"
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function ConnectSheet({
  open,
  draft,
  nodes,
  onClose,
  onDirection,
  onTarget,
}: {
  open: boolean;
  draft: ConnectDraft | null;
  nodes: GoalGraphNodeModel[];
  onClose: () => void;
  onDirection: (direction: ConnectDraft["direction"]) => void;
  onTarget: (node: GoalGraphNodeModel) => void;
}) {
  const candidates = nodes.filter((node) => isRealMemberNode(node) && node.id !== draft?.node.id);

  return (
    <Sheet open={open} onClose={onClose} title="连前置">
      <div className="space-y-3 px-4 pb-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onDirection("from-current")}
            className="min-h-11 rounded-ctl border border-border px-3 text-sm text-ink"
          >
            让它先于别人
          </button>
          <button
            type="button"
            onClick={() => onDirection("to-current")}
            className="min-h-11 rounded-ctl border border-border px-3 text-sm text-ink"
          >
            让它等待别人
          </button>
        </div>
        {draft?.direction && (
          <div className="grid gap-2">
            {candidates.map((node) => (
              <button
                key={node.id}
                type="button"
                aria-label={`选择前置目标 ${node.title}`}
                onClick={() => onTarget(node)}
                className="min-h-11 rounded-row border border-border bg-surface px-3 text-left text-sm text-ink"
              >
                {node.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
