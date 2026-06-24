import type { GoalLayoutPin, GoalLayoutPinNodeKind } from "./types.js";

const NODE_KINDS = new Set<GoalLayoutPinNodeKind>(["goal", "task", "track"]);

export interface GoalLayoutPinIdentity {
  goalId: string;
  nodeKind: GoalLayoutPinNodeKind;
  nodeId: string;
}

export function encodeGoalLayoutPinKey(goalId: string, nodeKind: GoalLayoutPinNodeKind, nodeId: string): string {
  return [encodeURIComponent(goalId), nodeKind, encodeURIComponent(nodeId)].join("|");
}

export function decodeGoalLayoutPinKey(key: string): GoalLayoutPinIdentity {
  const parts = key.split("|");
  if (parts.length !== 3) throw new Error(`Invalid goal layout pin key: ${key}`);

  const encodedGoalId = parts[0] ?? "";
  const nodeKind = parts[1] ?? "";
  const encodedNodeId = parts[2] ?? "";
  if (!NODE_KINDS.has(nodeKind as GoalLayoutPinNodeKind)) {
    throw new Error(`Invalid goal layout pin node kind: ${nodeKind}`);
  }

  return {
    goalId: decodeURIComponent(encodedGoalId),
    nodeKind: nodeKind as GoalLayoutPinNodeKind,
    nodeId: decodeURIComponent(encodedNodeId),
  };
}

export function goalLayoutPinKey(pin: GoalLayoutPinIdentity): string {
  return encodeGoalLayoutPinKey(pin.goalId, pin.nodeKind, pin.nodeId);
}

export function goalLayoutPinRecordId(pin: GoalLayoutPin): string {
  return goalLayoutPinKey(pin);
}
