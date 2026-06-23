import type { GoalMemberRef, Track } from "@timedata/shared";
import type { GoalOverview, GoalMember } from "./goalsView.js";

export const GOAL_NODE_ID = "goal";

export type GoalGraphNodeKind = "task" | "track" | "goal" | "ghost";

export type GoalGraphNodeStatus = "ready" | "blocked" | "completed" | "parked" | "active" | "ghost" | "anchor";

export interface GoalGraphNode {
  id: string;
  kind: GoalGraphNodeKind;
  status: GoalGraphNodeStatus;
  title: string;
  ref: GoalMemberRef | null;
  hasDependency: boolean;
}

export interface GoalGraphEdge {
  id: string;
  kind: "prerequisite" | "broken-prerequisite" | "tether";
  source: string;
  target: string;
}

export interface GoalGraphModel {
  goalNodeId: string;
  nodes: GoalGraphNode[];
  edges: GoalGraphEdge[];
  summary: { ready: number; blocked: number; completed: number };
}

export function graphNodeId(ref: GoalMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

function goalMemberKey(ref: GoalMemberRef): string {
  return graphNodeId(ref);
}

function ghostNodeId(ref: GoalMemberRef): string {
  return `ghost:${graphNodeId(ref)}`;
}

function ghostTitle(ref: GoalMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

function isTrackSource(source: GoalMember["source"]): source is Track {
  return "status" in source;
}

function memberStatus(member: GoalMember, overview: GoalOverview): GoalGraphNodeStatus {
  if (overview.sections.completed.some((item) => item.kind === member.kind && item.id === member.id)) return "completed";
  if (overview.sections.blocked.some((item) => item.kind === member.kind && item.id === member.id)) return "blocked";
  if (member.kind === "track" && isTrackSource(member.source)) return member.source.status === "parked" ? "parked" : "active";
  return "ready";
}

function makeEdge(kind: GoalGraphEdge["kind"], source: string, target: string): GoalGraphEdge {
  return {
    id: `${kind}:${source}->${target}`,
    kind,
    source,
    target,
  };
}

export function buildGoalGraphModel(overview: GoalOverview): GoalGraphModel {
  const nodesById = new Map<string, GoalGraphNode>();
  const edges: GoalGraphEdge[] = [];
  const dependencyNodeIds = new Set<string>();

  nodesById.set(GOAL_NODE_ID, {
    id: GOAL_NODE_ID,
    kind: "goal",
    status: "anchor",
    title: overview.goal.title,
    ref: null,
    hasDependency: false,
  });

  for (const member of overview.members) {
    const ref: GoalMemberRef = { kind: member.kind, id: member.id };
    nodesById.set(goalMemberKey(ref), {
      id: goalMemberKey(ref),
      kind: member.kind,
      status: memberStatus(member, overview),
      title: member.title,
      ref,
      hasDependency: false,
    });
  }

  for (const ref of overview.missingMembers) {
    ensureGhostNode(nodesById, ref);
  }

  for (const ref of overview.goal.members ?? []) {
    const node = ensureGraphNode(nodesById, ref);
    edges.push(makeEdge("tether", GOAL_NODE_ID, node.id));
  }

  for (const prerequisite of overview.goal.prerequisites ?? []) {
    const blockerNode = ensureGraphNode(nodesById, prerequisite.blocker);
    const blockedNode = ensureGraphNode(nodesById, prerequisite.blocked);
    const blockerId = blockerNode.id;
    const blockedId = blockedNode.id;
    const kind: GoalGraphEdge["kind"] = blockerNode.kind === "ghost" || blockedNode.kind === "ghost" ? "broken-prerequisite" : "prerequisite";

    edges.push(makeEdge(kind, blockerId, blockedId));
    dependencyNodeIds.add(blockerId);
    dependencyNodeIds.add(blockedId);
  }

  const nodes = [...nodesById.values()].map((node) =>
    node.id === GOAL_NODE_ID ? node : { ...node, hasDependency: dependencyNodeIds.has(node.id) },
  );

  return {
    goalNodeId: GOAL_NODE_ID,
    nodes,
    edges,
    summary: {
      ready: overview.sections.ready.length,
      blocked: overview.sections.blocked.length,
      completed: overview.sections.completed.length,
    },
  };
}

function ensureGraphNode(nodesById: Map<string, GoalGraphNode>, ref: GoalMemberRef): GoalGraphNode {
  const id = goalMemberKey(ref);
  const existing = nodesById.get(id);
  if (existing) return existing;

  return ensureGhostNode(nodesById, ref);
}

function ensureGhostNode(nodesById: Map<string, GoalGraphNode>, ref: GoalMemberRef): GoalGraphNode {
  const realId = goalMemberKey(ref);
  const existingReal = nodesById.get(realId);
  if (existingReal) return existingReal;

  const id = ghostNodeId(ref);
  const existing = nodesById.get(id);
  if (existing) return existing;

  const ghost: GoalGraphNode = {
    id,
    kind: "ghost",
    status: "ghost",
    title: ghostTitle(ref),
    ref,
    hasDependency: false,
  };
  nodesById.set(id, ghost);
  return ghost;
}
