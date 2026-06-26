import type { GoalMemberRef } from "@timedata/shared";

export const GOAL_MEMBER_DRAG_MIME = "application/x-goal-member";

export function writeDragRef(dataTransfer: DataTransfer, ref: GoalMemberRef): void {
  dataTransfer.setData(GOAL_MEMBER_DRAG_MIME, JSON.stringify(ref));
  dataTransfer.effectAllowed = "copy";
}

export function readDragRef(dataTransfer: DataTransfer): GoalMemberRef | null {
  const raw = dataTransfer.getData(GOAL_MEMBER_DRAG_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; id?: unknown };
    if ((parsed.kind === "task" || parsed.kind === "track") && typeof parsed.id === "string" && parsed.id.length > 0) {
      return { kind: parsed.kind, id: parsed.id };
    }
  } catch {
    return null;
  }

  return null;
}
