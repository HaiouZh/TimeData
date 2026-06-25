import { deleteGoalLayoutPin } from "../../lib/goalLayoutPins.js";
import { galaxyPinRef } from "./galaxyPinRef.js";

function goalIdsFromAnchorIds(anchorIds: string[]): string[] {
  return anchorIds.flatMap((anchorId) => {
    if (!anchorId.startsWith("goal:")) return [];
    const goalId = anchorId.slice("goal:".length);
    return goalId ? [goalId] : [];
  });
}

export async function restoreGalaxyPin({
  nodeId,
  anchorIds,
  syncAfterWrite,
}: {
  nodeId: string;
  anchorIds: string[];
  syncAfterWrite: () => void;
}): Promise<void> {
  const ref = galaxyPinRef(nodeId, goalIdsFromAnchorIds(anchorIds));
  if (!ref) return;

  await deleteGoalLayoutPin(ref);
  syncAfterWrite();
}
