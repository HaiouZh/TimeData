import type { GoalLayoutPinRef } from "../../lib/goalLayoutPins.js";

export function galaxyPinRef(nodeId: string, owningGoalIds: string[]): GoalLayoutPinRef | null {
  if (nodeId.startsWith("goal:")) {
    const goalId = nodeId.slice("goal:".length);
    return goalId ? { goalId, nodeKind: "goal", nodeId: goalId } : null;
  }
  if (nodeId.startsWith("ghost:")) return null;
  if (owningGoalIds.length !== 1) return null;

  const separator = nodeId.indexOf(":");
  if (separator < 1) return null;
  const nodeKind = nodeId.slice(0, separator);
  const id = nodeId.slice(separator + 1);
  if (id.length === 0) return null;
  if (nodeKind !== "task" && nodeKind !== "track") return null;

  return { goalId: owningGoalIds[0], nodeKind, nodeId: id };
}
