import type { Goal, GoalLayoutPin } from "@timedata/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GOAL_NODE_ID, type GoalGraphModel } from "../../lib/goalGraphModel.js";
import { goalGraphLayout, type GoalGraphNodeBox, type GoalGraphOrientation } from "../../lib/goalGraphLayout.js";
import {
  goalCanvasFromPin,
  goalPinFromCanvas,
  memberCanvasFromPin,
  memberPinFromCanvas,
  type XY,
} from "../../lib/goalLayoutCoords.js";
import { deleteGoalLayoutPin, upsertGoalLayoutPin, type GoalLayoutPinRef } from "../../lib/goalLayoutPins.js";
import { pinRefFromNodeId } from "./goalLayoutPinRefs.js";

export interface GoalLayoutController {
  positions: Record<string, XY>;
  pinnedIds: Set<string>;
  boxes: Record<string, GoalGraphNodeBox>;
  onNodeDrag: (nodeId: string, position: XY) => void;
  onNodeDragStop: (nodeId: string, position: XY) => void;
  restorePin: (nodeId: string) => void;
  restoreLayout: () => void;
}

export interface UseGoalGraphLayoutArgs {
  goal: Goal;
  model: GoalGraphModel;
  orientation: GoalGraphOrientation;
  layoutPins: GoalLayoutPin[];
  onChanged: () => void;
}

interface ParsedPins {
  goal: XY | null;
  members: Record<string, XY>;
}

interface DragState {
  nodeId: string;
  position: XY;
}

const DEFAULT_ANCHOR_CANVAS: XY = { x: 0, y: 0 };
const DEFAULT_NODE_BOX: GoalGraphNodeBox = { width: 180, height: 56 };
const COLLISION_PADDING = 6;
const COLLISION_ITERATIONS = 24;
const COLLISION_SEARCH_STEP = 32;
const COLLISION_SEARCH_RINGS = 16;

function boxCenter(position: XY, box: GoalGraphNodeBox): XY {
  return { x: position.x + (box.offsetX ?? 0), y: position.y + (box.offsetY ?? 0) };
}

function rectFor(position: XY, box: GoalGraphNodeBox): { left: number; right: number; top: number; bottom: number } {
  const center = boxCenter(position, box);
  return {
    left: center.x - box.width / 2,
    right: center.x + box.width / 2,
    top: center.y - box.height / 2,
    bottom: center.y + box.height / 2,
  };
}

function overlapAmount(
  leftPosition: XY,
  leftBox: GoalGraphNodeBox,
  rightPosition: XY,
  rightBox: GoalGraphNodeBox,
): { x: number; y: number; delta: XY } {
  const left = rectFor(leftPosition, leftBox);
  const right = rectFor(rightPosition, rightBox);
  const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left) + COLLISION_PADDING;
  const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) + COLLISION_PADDING;
  const leftCenter = boxCenter(leftPosition, leftBox);
  const rightCenter = boxCenter(rightPosition, rightBox);
  return { x: overlapX, y: overlapY, delta: { x: rightCenter.x - leftCenter.x, y: rightCenter.y - leftCenter.y } };
}

function boxesOverlap(leftPosition: XY, leftBox: GoalGraphNodeBox, rightPosition: XY, rightBox: GoalGraphNodeBox): boolean {
  const overlap = overlapAmount(leftPosition, leftBox, rightPosition, rightBox);
  return overlap.x > 0 && overlap.y > 0;
}

function nudgeAwayFromCollisions(
  nodeId: string,
  position: XY,
  positions: Record<string, XY>,
  boxes: Record<string, GoalGraphNodeBox>,
): XY {
  const nodeBox = boxes[nodeId] ?? DEFAULT_NODE_BOX;
  const next = { ...position };

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
    let moved = false;

    for (const [otherId, other] of Object.entries(positions)) {
      if (otherId === nodeId) continue;

      const otherBox = boxes[otherId] ?? DEFAULT_NODE_BOX;
      const overlap = overlapAmount(other, otherBox, next, nodeBox);
      if (overlap.x <= 0 || overlap.y <= 0) continue;

      moved = true;
      const axis = overlap.x <= overlap.y ? "x" : "y";
      if (axis === "x") {
        const sign = overlap.delta.x === 0 ? stableDirection(`${otherId}:${nodeId}`, "x") : Math.sign(overlap.delta.x);
        next.x += sign * (overlap.x + 1);
      } else {
        const sign = overlap.delta.y === 0 ? stableDirection(`${otherId}:${nodeId}`, "y") : Math.sign(overlap.delta.y);
        next.y += sign * (overlap.y + 1);
      }
    }

    if (!moved) break;
  }

  return next;
}

function parsePins(goal: Goal, layoutPins: GoalLayoutPin[]): ParsedPins {
  const members: Record<string, XY> = {};
  let goalPin: XY | null = null;

  for (const pin of layoutPins) {
    if (pin.goalId !== goal.id) continue;
    if (pin.nodeKind === "goal" && pin.nodeId === goal.id) {
      goalPin = goalCanvasFromPin(pin);
      continue;
    }
    if (pin.nodeKind === "task" || pin.nodeKind === "track") {
      members[`${pin.nodeKind}:${pin.nodeId}`] = { x: pin.x, y: pin.y };
    }
  }

  return { goal: goalPin, members };
}

function memberRefFromNodeId(nodeId: string, goalId: string): GoalLayoutPinRef | null {
  const ref = pinRefFromNodeId(nodeId, goalId);
  if (!ref || ref.nodeKind === "goal") return null;
  return ref;
}

function structureKey(
  model: GoalGraphModel,
  orientation: GoalGraphOrientation,
  pins: ParsedPins,
  anchorCanvas: XY,
): string {
  const pinKey = Object.entries(pins.members)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, position]) => `${id}:${position.x},${position.y}`)
    .join("|");
  return `${orientation}#${anchorCanvas.x},${anchorCanvas.y}#${model.nodes.map((node) => node.id).join("|")}#${model.edges
    .map((edge) => edge.id)
    .join("|")}#${pinKey}`;
}

function shiftPositions(positions: Record<string, XY>, delta: XY): Record<string, XY> {
  if (delta.x === 0 && delta.y === 0) return positions;
  return Object.fromEntries(
    Object.entries(positions).map(([nodeId, position]) => [
      nodeId,
      {
        x: position.x + delta.x,
        y: position.y + delta.y,
      },
    ]),
  );
}

function stableDirection(id: string, axis: "x" | "y"): number {
  const seed = [...id].reduce((hash, char) => hash + char.charCodeAt(0), axis === "x" ? 17 : 29);
  return seed % 2 === 0 ? 1 : -1;
}

function resolveLocalCollisions(
  positions: Record<string, XY>,
  boxes: Record<string, GoalGraphNodeBox>,
  fixedIds: Set<string>,
): Record<string, XY> {
  const next = Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, { ...position }]));
  const ids = Object.keys(next);

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
    let moved = false;

    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const leftId = ids[leftIndex];
        const rightId = ids[rightIndex];
        const left = next[leftId];
        const right = next[rightId];
        if (!left || !right) continue;

        const leftBox = boxes[leftId] ?? DEFAULT_NODE_BOX;
        const rightBox = boxes[rightId] ?? DEFAULT_NODE_BOX;
        const { x: overlapX, y: overlapY, delta } = overlapAmount(left, leftBox, right, rightBox);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const leftFixed = fixedIds.has(leftId);
        const rightFixed = fixedIds.has(rightId);
        if (leftFixed && rightFixed) continue;

        moved = true;
        const axis = overlapX <= overlapY ? "x" : "y";
        const sign = axis === "x" ? (delta.x === 0 ? stableDirection(`${leftId}:${rightId}`, "x") : Math.sign(delta.x)) : delta.y === 0 ? stableDirection(`${leftId}:${rightId}`, "y") : Math.sign(delta.y);
        const push = (axis === "x" ? overlapX : overlapY) + 1;

        if (axis === "x") {
          if (leftFixed) right.x += sign * push;
          else if (rightFixed) left.x -= sign * push;
          else {
            left.x -= (sign * push) / 2;
            right.x += (sign * push) / 2;
          }
        } else if (leftFixed) {
          right.y += sign * push;
        } else if (rightFixed) {
          left.y -= sign * push;
        } else {
          left.y -= (sign * push) / 2;
          right.y += (sign * push) / 2;
        }
      }
    }

    if (!moved) break;
  }

  return next;
}

function resolveDraggedCollision(
  nodeId: string,
  position: XY,
  positions: Record<string, XY>,
  boxes: Record<string, GoalGraphNodeBox>,
): XY {
  const nodeBox = boxes[nodeId] ?? DEFAULT_NODE_BOX;
  const collides = (candidate: XY): boolean =>
    Object.entries(positions).some(([otherId, other]) => {
      if (otherId === nodeId) return false;
      const otherBox = boxes[otherId] ?? DEFAULT_NODE_BOX;
      return boxesOverlap(candidate, nodeBox, other, otherBox);
    });

  if (!collides(position)) return position;

  const nudged = nudgeAwayFromCollisions(nodeId, position, positions, boxes);
  if (!collides(nudged)) return nudged;

  let best: XY | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let ring = 1; ring <= COLLISION_SEARCH_RINGS; ring += 1) {
    const radius = ring * COLLISION_SEARCH_STEP;
    for (let index = 0; index < 16; index += 1) {
      const angle = (Math.PI * 2 * index) / 16;
      const candidate = { x: position.x + Math.cos(angle) * radius, y: position.y + Math.sin(angle) * radius };
      if (collides(candidate)) continue;
      const distance = Math.hypot(candidate.x - position.x, candidate.y - position.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best) return best;
  }

  return nudged;
}

export function useGoalGraphLayout({
  goal,
  model,
  orientation,
  layoutPins,
  onChanged,
}: UseGoalGraphLayoutArgs): GoalLayoutController {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const pins = useMemo(() => parsePins(goal, layoutPins), [goal, layoutPins]);
  const dragRef = useMemo(
    () => (dragState ? pinRefFromNodeId(dragState.nodeId, goal.id) : null),
    [dragState, goal.id],
  );
  const anchorCanvas = pins.goal ?? DEFAULT_ANCHOR_CANVAS;

  const basePositions = useMemo(() => {
    const seedLayout = goalGraphLayout(model, { orientation });

    const fixedIds = new Set([GOAL_NODE_ID, ...Object.keys(pins.members)]);
    const seededPositions = Object.fromEntries(
      model.nodes.map((node) => {
        if (node.id === GOAL_NODE_ID) return [node.id, anchorCanvas];

        const memberPin = pins.members[node.id];
        if (memberPin) return [node.id, memberCanvasFromPin(memberPin, anchorCanvas)];

        const seed = seedLayout.positions[node.id] ?? DEFAULT_ANCHOR_CANVAS;
        return [
          node.id,
          {
            x: anchorCanvas.x + seed.x,
            y: anchorCanvas.y + seed.y,
          },
        ];
      }),
    );
    return resolveLocalCollisions(seededPositions, seedLayout.boxes, fixedIds);
  }, [anchorCanvas, model, orientation, pins.members]);
  const layoutBoxes = useMemo(() => goalGraphLayout(model, { orientation }).boxes, [model, orientation]);
  const [positions, setPositions] = useState<Record<string, XY>>(() => basePositions);
  const positionsRef = useRef<Record<string, XY>>(positions);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    const key = structureKey(model, orientation, pins, anchorCanvas);
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    setPositions(basePositions);
  }, [anchorCanvas, basePositions, model, orientation, pins]);

  const renderedPositions = useMemo(() => {
    if (!dragState) return positions;
    if (dragRef?.nodeKind === "goal") {
      const currentAnchor = positions[GOAL_NODE_ID] ?? DEFAULT_ANCHOR_CANVAS;
      const delta = {
        x: dragState.position.x - currentAnchor.x,
        y: dragState.position.y - currentAnchor.y,
      };
      return shiftPositions(positions, delta);
    }
    return { ...positions, [dragState.nodeId]: dragState.position };
  }, [dragRef, dragState, positions]);

  const pinnedIds = useMemo<Set<string>>(() => {
    const ids = new Set(Object.keys(pins.members));
    if (pins.goal) ids.add(GOAL_NODE_ID);
    return ids;
  }, [pins]);

  const onNodeDrag = useCallback(
    (nodeId: string, position: XY) => {
      const ref = pinRefFromNodeId(nodeId, goal.id);
      if (!ref) return;
      setDragState({ nodeId, position });
    },
    [goal.id],
  );

  const onNodeDragStop = useCallback(
    (nodeId: string, position: XY) => {
      const ref = pinRefFromNodeId(nodeId, goal.id);
      if (!ref) return;

      setDragState(null);
      const nextPosition =
        ref.nodeKind === "goal" ? position : resolveDraggedCollision(nodeId, position, positionsRef.current, layoutBoxes);
      setPositions((current) => {
        if (ref.nodeKind !== "goal") return { ...current, [nodeId]: nextPosition };
        const currentAnchor = current[GOAL_NODE_ID] ?? DEFAULT_ANCHOR_CANVAS;
        return shiftPositions(current, { x: nextPosition.x - currentAnchor.x, y: nextPosition.y - currentAnchor.y });
      });

      const currentAnchor = positionsRef.current[GOAL_NODE_ID] ?? anchorCanvas;
      const coords = ref.nodeKind === "goal" ? goalPinFromCanvas(nextPosition) : memberPinFromCanvas(nextPosition, currentAnchor);
      void upsertGoalLayoutPin({ ...ref, x: coords.x, y: coords.y }).then(onChanged);
    },
    [anchorCanvas, goal.id, layoutBoxes, onChanged],
  );

  const restorePin = useCallback(
    (nodeId: string) => {
      const ref = pinRefFromNodeId(nodeId, goal.id);
      if (!ref) return;
      void deleteGoalLayoutPin(ref).then(onChanged);
    },
    [goal.id, onChanged],
  );

  const restoreLayout = useCallback(() => {
    const refs = Object.keys(pins.members)
      .map((nodeId) => memberRefFromNodeId(nodeId, goal.id))
      .filter((ref): ref is GoalLayoutPinRef => ref !== null);
    void Promise.all(refs.map((ref) => deleteGoalLayoutPin(ref))).then(onChanged);
  }, [goal.id, onChanged, pins.members]);

  return { positions: renderedPositions, pinnedIds, boxes: layoutBoxes, onNodeDrag, onNodeDragStop, restorePin, restoreLayout };
}
