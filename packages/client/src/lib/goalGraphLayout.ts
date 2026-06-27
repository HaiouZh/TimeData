export type GoalGraphOrientation = "horizontal" | "vertical";

export interface GoalGraphPosition {
  x: number;
  y: number;
}

export type GoalGraphNodeLayoutKind = "goal" | "task" | "track" | "ghost";

export interface GoalGraphNodeBox {
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
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

const DEFAULT_BOX: GoalGraphNodeBox = { width: 180, height: 56 };
const NODE_BOX_BY_KIND: Record<GoalGraphNodeLayoutKind, GoalGraphNodeBox> = {
  goal: { width: 112, height: 112 },
  task: { width: 228, height: 48, offsetX: 94 },
  track: { width: 190, height: 56 },
  ghost: { width: 170, height: 56 },
};
const RANK_GAP = 96;
const STACK_GAP = 32;
const ORBIT_GAP = 72;
const MIN_ORBIT_RADIUS = 260;

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

function orbitPosition(index: number, count: number, radius: number): GoalGraphPosition {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(count, 1);
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
  return boxes.reduce((max, box) => Math.max(max, box[dimension] ?? 0), 0);
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
    MIN_ORBIT_RADIUS,
    fallbackRadius,
  );
}

function orderedOrbitNodes(model: GoalGraphModelLike, ranks: Record<string, number>): GoalGraphNodeLike[] {
  return model.nodes
    .filter((node) => node.id !== model.goalNodeId)
    .map((node, index) => ({
      node,
      index,
      rank: ranks[node.id] ?? Number.POSITIVE_INFINITY,
    }))
    .sort(
      (left, right) => left.rank - right.rank || left.index - right.index || left.node.id.localeCompare(right.node.id),
    )
    .map((item) => item.node);
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
  const boxes = buildBoxes(model.nodes);
  const positions: Record<string, GoalGraphPosition> = {
    [model.goalNodeId]: { x: 0, y: 0 },
  };

  const orbitNodes = orderedOrbitNodes(model, ranks);
  const orbitBoxes = orbitNodes.map((node) => boxes[node.id] ?? DEFAULT_BOX);
  const radius = orbitRadius(
    boxes[model.goalNodeId] ?? DEFAULT_BOX,
    orbitBoxes,
    options.orbitRadius ?? Math.max(options.rankGap ?? RANK_GAP, options.nodeGap ?? STACK_GAP) * 1.5,
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
