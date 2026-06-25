import type { GoalLayoutPinRef } from "../../lib/goalLayoutPins.js";

export function pinRefFromNodeId(nodeId: string, goalId: string): GoalLayoutPinRef | null {
  if (nodeId === "goal") return { goalId, nodeKind: "goal", nodeId: goalId };
  if (nodeId.startsWith("ghost:")) return null;

  const separator = nodeId.indexOf(":");
  if (separator < 1) return null;

  const nodeKind = nodeId.slice(0, separator);
  const id = nodeId.slice(separator + 1);
  if (id.length === 0) return null;
  if (nodeKind !== "task" && nodeKind !== "track") return null;

  return { goalId, nodeKind, nodeId: id };
}
