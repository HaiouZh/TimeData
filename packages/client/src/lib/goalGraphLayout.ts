export type GoalGraphOrientation = "horizontal" | "vertical";

export interface GoalGraphPosition {
  x: number;
  y: number;
}

export type GoalGraphNodeLayoutKind = "goal" | "task" | "track" | "ghost";

export interface GoalGraphNodeBox {
  width: number;
  height: number;
}

export interface GoalGraphLayout {
  positions: Record<string, GoalGraphPosition>;
  boxes: Record<string, GoalGraphNodeBox>;
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
  kind?: GoalGraphNodeLayoutKind;
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

const DEFAULT_BOX: GoalGraphNodeBox = { width: 180, height: 56 };
const NODE_BOX_BY_KIND: Record<GoalGraphNodeLayoutKind, GoalGraphNodeBox> = {
  goal: { width: 220, height: 80 },
  task: { width: 240, height: 56 },
  track: { width: 190, height: 56 },
  ghost: { width: 170, height: 56 },
};
const RANK_GAP = 96;
const STACK_GAP = 32;
const ORBIT_GAP = 72;

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

function stackedCenter(index: number, boxes: GoalGraphNodeBox[], gap: number, dimension: keyof GoalGraphNodeBox): number {
  const total = boxes.reduce((sum, box) => sum + box[dimension], 0) + Math.max(0, boxes.length - 1) * gap;
  const before = boxes.slice(0, index).reduce((sum, box) => sum + box[dimension], 0) + index * gap;
  return before + boxes[index][dimension] / 2 - total / 2;
}

function orbitPosition(index: number, count: number, radius: number): GoalGraphPosition {
  const angle = -Math.PI / 4 + (Math.PI * 2 * index) / Math.max(count, 1);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function boxFor(node: GoalGraphNodeLike): GoalGraphNodeBox {
  return node.kind ? NODE_BOX_BY_KIND[node.kind] : DEFAULT_BOX;
}

function buildBoxes(nodes: GoalGraphNodeLike[]): Record<string, GoalGraphNodeBox> {
  return Object.fromEntries(nodes.map((node) => [node.id, boxFor(node)]));
}

function maxDimension(boxes: GoalGraphNodeBox[], dimension: keyof GoalGraphNodeBox): number {
  return boxes.reduce((max, box) => Math.max(max, box[dimension]), 0);
}

function orbitRadius(goalBox: GoalGraphNodeBox, orbitBoxes: GoalGraphNodeBox[], fallbackRadius: number): number {
  if (orbitBoxes.length === 0) return fallbackRadius;
  const count = orbitBoxes.length;
  const maxWidth = maxDimension(orbitBoxes, "width") || DEFAULT_BOX.width;
  const maxHeight = maxDimension(orbitBoxes, "height") || DEFAULT_BOX.height;
  const circumferenceRadius = (count * (maxWidth + ORBIT_GAP)) / (2 * Math.PI);
  return Math.max(
    goalBox.width / 2 + maxWidth / 2 + ORBIT_GAP,
    goalBox.height / 2 + maxHeight / 2 + ORBIT_GAP,
    circumferenceRadius,
    fallbackRadius,
  );
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
  const rankGap = options.rankGap ?? RANK_GAP;
  const nodeGap = options.nodeGap ?? STACK_GAP;
  const boxes = buildBoxes(model.nodes);
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
  let previousRankCenter = 0;
  let previousRankSize = boxes[model.goalNodeId]?.width ?? DEFAULT_BOX.width;
  let previousRankHeight = boxes[model.goalNodeId]?.height ?? DEFAULT_BOX.height;
  for (const rank of sortedRanks) {
    const members = groupedByRank.get(rank) ?? [];
    members.sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
    const memberBoxes = members.map((member) => boxes[member.id] ?? DEFAULT_BOX);
    const rankWidth = maxDimension(memberBoxes, "width") || DEFAULT_BOX.width;
    const rankHeight = maxDimension(memberBoxes, "height") || DEFAULT_BOX.height;
    const horizontalCenter = previousRankCenter + previousRankSize / 2 + rankGap + rankWidth / 2;
    const verticalCenter = previousRankCenter + previousRankHeight / 2 + rankGap + rankHeight / 2;

    for (const [index, placement] of members.entries()) {
      const offset =
        options.orientation === "horizontal"
          ? stackedCenter(index, memberBoxes, nodeGap, "height")
          : stackedCenter(index, memberBoxes, nodeGap, "width");
      positions[placement.id] =
        options.orientation === "horizontal"
          ? { x: horizontalCenter, y: offset }
          : { x: offset, y: verticalCenter };
    }
    previousRankCenter = options.orientation === "horizontal" ? horizontalCenter : verticalCenter;
    previousRankSize = rankWidth;
    previousRankHeight = rankHeight;
  }

  const orbitNodes = model.nodes.filter((node) => node.id !== model.goalNodeId && ranks[node.id] === undefined);
  const orbitBoxes = orbitNodes.map((node) => boxes[node.id] ?? DEFAULT_BOX);
  const radius = orbitRadius(
    boxes[model.goalNodeId] ?? DEFAULT_BOX,
    orbitBoxes,
    options.orbitRadius ?? Math.max(rankGap, nodeGap) * 1.5,
  );
  for (const [index, node] of orbitNodes.entries()) {
    positions[node.id] = orbitPosition(index, orbitNodes.length || 1, radius);
  }

  return {
    positions,
    boxes,
    orientation: options.orientation,
  };
}
