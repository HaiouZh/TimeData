import type { Goal, GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import type { ClusterLod } from "./goalGalaxyLod.js";
import { buildGoalGraphModel, GOAL_NODE_ID, type GoalGraphEdge, type GoalGraphNodeKind } from "./goalGraphModel.js";
import { buildGoalOverview } from "./goalsView.js";

export interface GalaxyStar {
  nodeId: string;
  goalId: string;
  title: string;
  completed: number;
  total: number;
  memberCount: number;
  lod: ClusterLod;
}

export interface GalaxyNode {
  id: string;
  kind: GoalGraphNodeKind;
  title: string;
  anchorIds: string[];
  lod: ClusterLod;
  status: string;
  ref: GoalMemberRef | null;
}

export interface GalaxyEdge {
  id: string;
  kind: GoalGraphEdge["kind"];
  source: string;
  target: string;
  goalId?: string;
}

export interface GalaxyModel {
  stars: GalaxyStar[];
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
}

function anchorNodeId(goalId: string): string {
  return `goal:${goalId}`;
}

function addAnchor(node: GalaxyNode, anchorId: string): void {
  if (!node.anchorIds.includes(anchorId)) {
    node.anchorIds.push(anchorId);
  }
}

function nodeLod(anchorIds: string[], lodByAnchorId: Map<string, ClusterLod>): ClusterLod {
  return anchorIds.some((anchorId) => lodByAnchorId.get(anchorId) === "expanded") ? "expanded" : "collapsed";
}

export function buildGoalGalaxyModel(args: {
  goals: Goal[];
  tasks: Task[];
  tracks: Track[];
  steps: TrackStep[];
  lodByGoalId: Record<string, ClusterLod>;
  now?: Date;
}): GalaxyModel {
  const { goals, tasks, tracks, steps, lodByGoalId, now } = args;
  const stars: GalaxyStar[] = [];
  const nodesById = new Map<string, GalaxyNode>();
  const edges: GalaxyEdge[] = [];
  const lodByAnchorId = new Map<string, ClusterLod>();

  for (const goal of goals) {
    if (goal.status !== "active") continue;

    const overview = buildGoalOverview(goal, tasks, tracks, steps, now ? { now } : {});
    const anchorId = anchorNodeId(goal.id);
    const lod = lodByGoalId[goal.id] ?? "collapsed";
    lodByAnchorId.set(anchorId, lod);

    stars.push({
      nodeId: anchorId,
      goalId: goal.id,
      title: goal.title,
      completed: overview.progress.kind === "project" ? overview.progress.completed : 0,
      total: overview.progress.kind === "project" ? overview.progress.total : 0,
      memberCount: overview.members.length,
      lod,
    });

    const graph = buildGoalGraphModel(overview);
    for (const node of graph.nodes) {
      if (node.id === GOAL_NODE_ID || node.kind === "ghost") continue;
      const existing = nodesById.get(node.id);
      if (existing) {
        addAnchor(existing, anchorId);
        existing.lod = nodeLod(existing.anchorIds, lodByAnchorId);
        continue;
      }
      nodesById.set(node.id, {
        id: node.id,
        kind: node.kind,
        title: node.title,
        anchorIds: [anchorId],
        lod,
        status: node.status,
        ref: node.ref,
      });
    }

    for (const edge of graph.edges) {
      if (edge.kind === "tether") {
        if (!nodesById.has(edge.target)) continue;
        edges.push({
          id: `tether:${anchorId}->${edge.target}`,
          kind: "tether",
          source: anchorId,
          target: edge.target,
        });
        continue;
      }
      if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
      edges.push({
        id: `${edge.kind}:${goal.id}:${edge.source}->${edge.target}`,
        kind: edge.kind,
        source: edge.source,
        target: edge.target,
        goalId: goal.id,
      });
    }
  }

  return { stars, nodes: [...nodesById.values()], edges };
}
