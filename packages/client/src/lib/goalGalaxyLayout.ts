import type { GalaxyModel, GalaxyNode } from "./goalGalaxyModel.js";
import { type GoalGraphNodeBox, goalGraphLayout } from "./goalGraphLayout.js";

export interface XY {
  x: number;
  y: number;
}

export interface GalaxyLayoutInput {
  model: GalaxyModel;
  anchorCanvasById: Record<string, XY>;
  memberPinByNodeId: Record<string, { goalId: string; x: number; y: number }>;
  pinnedAnchorIds?: ReadonlySet<string>;
}

const DEFAULT_BOX: GoalGraphNodeBox = { width: 180, height: 56 };
const COLLISION_PADDING = 6;
const COLLISION_ITERATIONS = 24;
const ANCHOR_SOLVE_PASSES = 8;

function boxFor(kind: string): GoalGraphNodeBox {
  if (kind === "goal") return { width: 220, height: 80 };
  if (kind === "task") return { width: 228, height: 48, offsetX: 94 };
  if (kind === "track") return { width: 190, height: 56 };
  return DEFAULT_BOX;
}

function rectFor(position: XY, box: GoalGraphNodeBox) {
  const center = {
    x: position.x + (box.offsetX ?? 0),
    y: position.y + (box.offsetY ?? 0),
  };
  return {
    left: center.x - box.width / 2,
    right: center.x + box.width / 2,
    top: center.y - box.height / 2,
    bottom: center.y + box.height / 2,
  };
}

function overlap(leftPosition: XY, leftBox: GoalGraphNodeBox, rightPosition: XY, rightBox: GoalGraphNodeBox) {
  const left = rectFor(leftPosition, leftBox);
  const right = rectFor(rightPosition, rightBox);
  return {
    x: Math.min(left.right, right.right) - Math.max(left.left, right.left) + COLLISION_PADDING,
    y: Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) + COLLISION_PADDING,
    dx: rightPosition.x - leftPosition.x,
    dy: rightPosition.y - leftPosition.y,
  };
}

function stableSign(id: string, axis: "x" | "y"): number {
  const seed = [...id].reduce((hash, char) => hash + char.charCodeAt(0), axis === "x" ? 17 : 29);
  return seed % 2 === 0 ? 1 : -1;
}

function seedOffsets(model: GalaxyModel): Record<string, Record<string, XY>> {
  const byAnchor: Record<string, Record<string, XY>> = {};
  for (const star of model.stars) {
    const members = model.nodes.filter((node) => node.anchorIds.includes(star.nodeId));
    const fakeModel = {
      goalNodeId: "goal",
      nodes: [{ id: "goal", kind: "goal" as const }, ...members.map((node) => ({ id: node.id, kind: node.kind }))],
      edges: model.edges
        .filter(
          (edge) =>
            (edge.source === star.nodeId || members.some((node) => node.id === edge.source)) &&
            members.some((node) => node.id === edge.target),
        )
        .map((edge) => ({
          source: edge.source === star.nodeId ? "goal" : edge.source,
          target: edge.target,
          kind: edge.kind,
        })),
    };
    byAnchor[star.nodeId] = goalGraphLayout(fakeModel, { orientation: "horizontal" }).positions;
  }
  return byAnchor;
}

function average(points: XY[]): XY {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function placeMember(node: GalaxyNode, input: GalaxyLayoutInput, seeds: Record<string, Record<string, XY>>): XY {
  if (node.anchorIds.length > 1) {
    return average(node.anchorIds.map((anchorId) => input.anchorCanvasById[anchorId] ?? { x: 0, y: 0 }));
  }
  const anchorId = node.anchorIds[0];
  const anchor = input.anchorCanvasById[anchorId] ?? { x: 0, y: 0 };
  const pin = input.memberPinByNodeId[`${anchorId}|${node.id}`] ?? input.memberPinByNodeId[node.id];
  if (pin && anchorId === `goal:${pin.goalId}`) {
    return { x: anchor.x + pin.x, y: anchor.y + pin.y };
  }
  const seed = seeds[anchorId]?.[node.id] ?? { x: 0, y: 0 };
  return { x: anchor.x + seed.x, y: anchor.y + seed.y };
}

function resolveCollisions(
  positions: Record<string, XY>,
  boxes: Record<string, GoalGraphNodeBox>,
  fixed: ReadonlySet<string>,
  shouldResolvePair: (leftId: string, rightId: string) => boolean = () => true,
): Record<string, XY> {
  const next = Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, { ...position }]));
  const ids = Object.keys(next);

  for (let iter = 0; iter < COLLISION_ITERATIONS; iter += 1) {
    let moved = false;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        if (!shouldResolvePair(a, b)) continue;
        const itemOverlap = overlap(next[a], boxes[a], next[b], boxes[b]);
        if (itemOverlap.x <= 0 || itemOverlap.y <= 0) continue;

        const aFixed = fixed.has(a);
        const bFixed = fixed.has(b);
        if (aFixed && bFixed) continue;

        moved = true;
        const axis = itemOverlap.x <= itemOverlap.y ? "x" : "y";
        const push = (axis === "x" ? itemOverlap.x : itemOverlap.y) + 1;
        const delta = axis === "x" ? itemOverlap.dx : itemOverlap.dy;
        const sign = delta === 0 ? stableSign(`${a}:${b}`, axis) : Math.sign(delta);

        if (axis === "x") {
          if (aFixed) next[b] = { ...next[b], x: next[b].x + sign * push };
          else if (bFixed) next[a] = { ...next[a], x: next[a].x - sign * push };
          else {
            next[a] = { ...next[a], x: next[a].x - (sign * push) / 2 };
            next[b] = { ...next[b], x: next[b].x + (sign * push) / 2 };
          }
          continue;
        }

        if (aFixed) next[b] = { ...next[b], y: next[b].y + sign * push };
        else if (bFixed) next[a] = { ...next[a], y: next[a].y - sign * push };
        else {
          next[a] = { ...next[a], y: next[a].y - (sign * push) / 2 };
          next[b] = { ...next[b], y: next[b].y + (sign * push) / 2 };
        }
      }
    }
    if (!moved) break;
  }

  return next;
}

function samePosition(left: XY | undefined, right: XY | undefined): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

function samePositions(left: Record<string, XY>, right: Record<string, XY>): boolean {
  const leftIds = Object.keys(left);
  if (leftIds.length !== Object.keys(right).length) return false;
  return leftIds.every((id) => samePosition(left[id], right[id]));
}

function splitPinnedMembers(
  input: GalaxyLayoutInput,
): Set<string> {
  const pinnedMemberIds = new Set<string>();
  for (const node of input.model.nodes) {
    const anchorId = node.anchorIds[0];
    const anchorGoalId = anchorId?.startsWith("goal:") ? anchorId.slice("goal:".length) : "";
    if (
      node.anchorIds.length === 1 &&
      (input.memberPinByNodeId[`${node.anchorIds[0]}|${node.id}`] ?? input.memberPinByNodeId[node.id])?.goalId ===
        anchorGoalId
    ) {
      pinnedMemberIds.add(node.id);
    }
  }
  return pinnedMemberIds;
}

function memberAnchorIds(input: GalaxyLayoutInput): Record<string, string[]> {
  return Object.fromEntries(input.model.nodes.map((node) => [node.id, node.anchorIds]));
}

function isOwnPinnedSingleGoalPair(
  leftId: string,
  rightId: string,
  anchorsByMemberId: Record<string, string[]>,
  pinnedMemberIds: ReadonlySet<string>,
): boolean {
  const leftIsGoal = leftId.startsWith("goal:");
  const rightIsGoal = rightId.startsWith("goal:");
  if (leftIsGoal === rightIsGoal) return false;

  const goalId = leftIsGoal ? leftId : rightId;
  const memberId = leftIsGoal ? rightId : leftId;
  const anchorIds = anchorsByMemberId[memberId] ?? [];
  return pinnedMemberIds.has(memberId) && anchorIds.length === 1 && anchorIds[0] === goalId;
}

function memberPositionsForAnchors(
  input: GalaxyLayoutInput,
  seeds: Record<string, Record<string, XY>>,
  anchorCanvasById: Record<string, XY>,
): Record<string, XY> {
  return Object.fromEntries(
    input.model.nodes.map((node) => [
      node.id,
      placeMember(node, { ...input, anchorCanvasById }, seeds),
    ]),
  );
}

export function goalGalaxyLayout(input: GalaxyLayoutInput): {
  positions: Record<string, XY>;
  boxes: Record<string, GoalGraphNodeBox>;
} {
  const seeds = seedOffsets(input.model);
  const boxes: Record<string, GoalGraphNodeBox> = {};
  const starBoxes: Record<string, GoalGraphNodeBox> = {};
  const starPositions: Record<string, XY> = {};
  const pinnedStarIds = input.pinnedAnchorIds ?? new Set<string>();
  const pinnedMemberIds = splitPinnedMembers(input);
  const anchorsByMemberId = memberAnchorIds(input);
  const shouldResolvePair = (leftId: string, rightId: string) =>
    !isOwnPinnedSingleGoalPair(leftId, rightId, anchorsByMemberId, pinnedMemberIds);

  for (const star of input.model.stars) {
    starPositions[star.nodeId] = input.anchorCanvasById[star.nodeId] ?? { x: 0, y: 0 };
    starBoxes[star.nodeId] = boxFor("goal");
  }

  Object.assign(boxes, starBoxes);
  for (const node of input.model.nodes) {
    boxes[node.id] = boxFor(node.kind);
  }

  let resolvedStarPositions = resolveCollisions(starPositions, starBoxes, pinnedStarIds);
  for (let pass = 0; pass < ANCHOR_SOLVE_PASSES; pass += 1) {
    const memberPositions = memberPositionsForAnchors(input, seeds, resolvedStarPositions);
    const allPositions = { ...resolvedStarPositions, ...memberPositions };
    const membersAsObstacles = new Set([...pinnedStarIds, ...Object.keys(memberPositions)]);
    const nextPositions = resolveCollisions(allPositions, boxes, membersAsObstacles, shouldResolvePair);
    const nextStarPositions = Object.fromEntries(
      input.model.stars.map((star) => [star.nodeId, nextPositions[star.nodeId] ?? resolvedStarPositions[star.nodeId]]),
    );
    if (samePositions(resolvedStarPositions, nextStarPositions)) break;
    resolvedStarPositions = nextStarPositions;
  }

  let positions = {
    ...resolvedStarPositions,
    ...memberPositionsForAnchors(input, seeds, resolvedStarPositions),
  };
  const hardFixed = new Set([...pinnedStarIds, ...pinnedMemberIds]);
  for (let pass = 0; pass < ANCHOR_SOLVE_PASSES; pass += 1) {
    const nextPositions = resolveCollisions(positions, boxes, hardFixed, shouldResolvePair);
    const nextStarPositions = Object.fromEntries(
      input.model.stars.map((star) => [star.nodeId, nextPositions[star.nodeId] ?? positions[star.nodeId]]),
    );
    if (samePositions(resolvedStarPositions, nextStarPositions)) {
      positions = nextPositions;
      break;
    }
    resolvedStarPositions = nextStarPositions;
    positions = {
      ...resolvedStarPositions,
      ...memberPositionsForAnchors(input, seeds, resolvedStarPositions),
    };
  }

  return { positions, boxes };
}
