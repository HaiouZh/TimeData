export type GoalGraphOrientation = "horizontal" | "vertical";

export interface GoalGraphPosition {
  x: number;
  y: number;
}

export interface GoalGraphLayout {
  positions: Record<string, GoalGraphPosition>;
  orientation: GoalGraphOrientation;
}

export interface GoalGraphLayoutOptions {
  orientation: GoalGraphOrientation;
  rankGap?: number;
  nodeGap?: number;
  orbitRadius?: number;
}

export interface GoalGraphNodeLike {
  id: string;
}

export type GoalGraphEdgeLike =
  | {
      id?: string;
      kind?: "prerequisite" | "broken-prerequisite" | "tether";
      source: string;
      target: string;
    }
  | {
      id?: string;
      kind?: "prerequisite" | "broken-prerequisite" | "tether";
      from: string;
      to: string;
    };

export interface GoalGraphModelLike {
  goalNodeId: string;
  nodes: GoalGraphNodeLike[];
  edges: GoalGraphEdgeLike[];
}

type NodePlacement = {
  id: string;
  rank: number;
  index: number;
};

function edgeSource(edge: GoalGraphEdgeLike): string {
  return "source" in edge ? edge.source : edge.from;
}

function edgeTarget(edge: GoalGraphEdgeLike): string {
  return "target" in edge ? edge.target : edge.to;
}

function isDependencyEdge(edge: GoalGraphEdgeLike): boolean {
  return edge.kind === "prerequisite" || edge.kind === "broken-prerequisite";
}

function buildDependencyGraph(model: GoalGraphModelLike): {
  incoming: Map<string, string[]>;
  dependencyNodeIds: Set<string>;
} {
  const incoming = new Map<string, string[]>();
  const dependencyNodeIds = new Set<string>();

  for (const node of model.nodes) {
    incoming.set(node.id, []);
  }

  for (const edge of model.edges) {
    if (!isDependencyEdge(edge)) continue;
    const source = edgeSource(edge);
    const target = edgeTarget(edge);
    if (!source || !target) continue;
    dependencyNodeIds.add(source);
    dependencyNodeIds.add(target);

    const list = incoming.get(target) ?? [];
    list.push(source);
    incoming.set(target, list);

    if (!incoming.has(source)) {
      incoming.set(source, incoming.get(source) ?? []);
    }
  }

  return { incoming, dependencyNodeIds };
}

function laneOffset(index: number, count: number, gap: number): number {
  return (index - (count - 1) / 2) * gap;
}

function orbitPosition(index: number, count: number, radius: number): GoalGraphPosition {
  const angle = -Math.PI / 4 + (Math.PI * 2 * index) / count;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function computeRanks(model: GoalGraphModelLike): Record<string, number> {
  const { incoming, dependencyNodeIds } = buildDependencyGraph(model);
  const ranks: Record<string, number> = {};
  const visiting = new Set<string>();

  function rankOf(id: string): number {
    const memoized = ranks[id];
    if (memoized !== undefined) return memoized;
    if (visiting.has(id)) return 0;

    visiting.add(id);
    const sources = incoming.get(id) ?? [];
    let rank = 0;
    for (const source of sources) {
      if (!dependencyNodeIds.has(source)) continue;
      rank = Math.max(rank, rankOf(source) + 1);
    }
    visiting.delete(id);
    ranks[id] = rank;
    return rank;
  }

  for (const id of dependencyNodeIds) {
    rankOf(id);
  }

  return ranks;
}

export function goalGraphLayout(model: GoalGraphModelLike, options: GoalGraphLayoutOptions): GoalGraphLayout {
  const ranks = computeRanks(model);
  const rankGap = options.rankGap ?? 120;
  const nodeGap = options.nodeGap ?? 48;
  const orbitRadius = options.orbitRadius ?? Math.max(rankGap, nodeGap) * 1.5;
  const positions: Record<string, GoalGraphPosition> = {
    [model.goalNodeId]: { x: 0, y: 0 },
  };

  const placements: NodePlacement[] = [];
  for (const [index, node] of model.nodes.entries()) {
    const rank = ranks[node.id];
    if (node.id === model.goalNodeId || rank === undefined) continue;
    placements.push({ id: node.id, rank, index });
  }

  const lanePlacements = placements.sort((left, right) => {
    return left.rank - right.rank || left.index - right.index || left.id.localeCompare(right.id);
  });

  const groupedByRank = new Map<number, NodePlacement[]>();
  for (const placement of lanePlacements) {
    const group = groupedByRank.get(placement.rank);
    if (group) {
      group.push(placement);
    } else {
      groupedByRank.set(placement.rank, [placement]);
    }
  }

  const sortedRanks = [...groupedByRank.keys()].sort((left, right) => left - right);
  for (const rank of sortedRanks) {
    const members = groupedByRank.get(rank) ?? [];
    members.sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
    for (const [index, placement] of members.entries()) {
      const offset = laneOffset(index, members.length, nodeGap);
      const laneRank = rank + 1;
      positions[placement.id] =
        options.orientation === "horizontal"
          ? { x: laneRank * rankGap, y: offset }
          : { x: offset, y: laneRank * rankGap };
    }
  }

  const orbitNodes = model.nodes.filter((node) => node.id !== model.goalNodeId && ranks[node.id] === undefined);
  for (const [index, node] of orbitNodes.entries()) {
    positions[node.id] = orbitPosition(index, orbitNodes.length || 1, orbitRadius);
  }

  return {
    positions,
    orientation: options.orientation,
  };
}
