import { NonEmptyTrimmedStringSchema } from "./entitySchemas.js";
import type { GoalLayoutPin, GoalLayoutPinNodeKind } from "./types.js";

const NODE_KINDS = new Set<GoalLayoutPinNodeKind>(["goal", "task", "track"]);

export interface GoalLayoutPinIdentity {
  goalId: string;
  nodeKind: GoalLayoutPinNodeKind;
  nodeId: string;
}

function decodeIdentityPart(encodedPart: string, key: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedPart);
  } catch {
    throw new Error(`Invalid goal layout pin key: ${key}`);
  }
  if (!NonEmptyTrimmedStringSchema.safeParse(decoded).success) {
    throw new Error(`Invalid goal layout pin key: ${key}`);
  }
  return decoded;
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
  const goalId = decodeIdentityPart(encodedGoalId, key);
  const nodeId = decodeIdentityPart(encodedNodeId, key);

  return {
    goalId,
    nodeKind: nodeKind as GoalLayoutPinNodeKind,
    nodeId,
  };
}

export function goalLayoutPinKey(pin: GoalLayoutPinIdentity): string {
  return encodeGoalLayoutPinKey(pin.goalId, pin.nodeKind, pin.nodeId);
}

export function goalLayoutPinRecordId(pin: GoalLayoutPin): string {
  return goalLayoutPinKey(pin);
}
