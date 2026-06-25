import { goalGraphLayout, type GoalGraphNodeBox } from "./goalGraphLayout.js";
import type { GalaxyModel, GalaxyNode } from "./goalGalaxyModel.js";

export interface XY {
  x: number;
  y: number;
}

export interface GalaxyLayoutInput {
  model: GalaxyModel;
  anchorCanvasById: Record<string, XY>;
  memberPinByNodeId: Record<string, { goalId: string; x: number; y: number }>;
}

const DEFAULT_BOX: GoalGraphNodeBox = { width: 180, height: 56 };
const COLLISION_PADDING = 6;
const COLLISION_ITERATIONS = 24;

function boxFor(kind: string): GoalGraphNodeBox {
  if (kind === "goal") return { width: 220, height: 80 };
  if (kind === "task") return { width: 228, height: 48 };
  if (kind === "track") return { width: 190, height: 56 };
  return DEFAULT_BOX;
}

function rectFor(position: XY, box: GoalGraphNodeBox) {
  return {
    left: position.x - box.width / 2,
    right: position.x + box.width / 2,
    top: position.y - box.height / 2,
    bottom: position.y + box.height / 2,
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

export function goalGalaxyLayout(input: GalaxyLayoutInput): { positions: Record<string, XY>; boxes: Record<string, GoalGraphNodeBox> } {
  const seeds = seedOffsets(input.model);
  const positions: Record<string, XY> = {};
  const boxes: Record<string, GoalGraphNodeBox> = {};
  const fixed = new Set<string>();

  for (const star of input.model.stars) {
    positions[star.nodeId] = input.anchorCanvasById[star.nodeId] ?? { x: 0, y: 0 };
    boxes[star.nodeId] = boxFor("goal");
    fixed.add(star.nodeId);
  }

  for (const node of input.model.nodes) {
    positions[node.id] = placeMember(node, input, seeds);
    boxes[node.id] = boxFor(node.kind);
    const anchorId = node.anchorIds[0];
    const anchorGoalId = anchorId?.startsWith("goal:") ? anchorId.slice("goal:".length) : "";
    if (
      node.anchorIds.length === 1 &&
      (input.memberPinByNodeId[`${node.anchorIds[0]}|${node.id}`] ?? input.memberPinByNodeId[node.id])?.goalId === anchorGoalId
    ) {
      fixed.add(node.id);
    }
  }

  const ids = Object.keys(positions);
  for (let iter = 0; iter < COLLISION_ITERATIONS; iter += 1) {
    let moved = false;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        const itemOverlap = overlap(positions[a], boxes[a], positions[b], boxes[b]);
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
          if (aFixed) positions[b] = { ...positions[b], x: positions[b].x + sign * push };
          else if (bFixed) positions[a] = { ...positions[a], x: positions[a].x - sign * push };
          else {
            positions[a] = { ...positions[a], x: positions[a].x - (sign * push) / 2 };
            positions[b] = { ...positions[b], x: positions[b].x + (sign * push) / 2 };
          }
          continue;
        }

        if (aFixed) positions[b] = { ...positions[b], y: positions[b].y + sign * push };
        else if (bFixed) positions[a] = { ...positions[a], y: positions[a].y - sign * push };
        else {
          positions[a] = { ...positions[a], y: positions[a].y - (sign * push) / 2 };
          positions[b] = { ...positions[b], y: positions[b].y + (sign * push) / 2 };
        }
      }
    }
    if (!moved) break;
  }

  return { positions, boxes };
}
