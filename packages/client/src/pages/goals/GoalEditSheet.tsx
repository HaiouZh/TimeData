import type { Goal } from "@timedata/shared";
import { Sheet } from "../../components/ui/Sheet.js";
import { GoalEditForm, type GoalEditPatch } from "./GoalEditForm.js";

export type { GoalEditPatch };

export interface GoalEditSheetProps {
  open: boolean;
  goal: Goal;
  onSave: (patch: GoalEditPatch) => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function GoalEditSheet({ open, goal, onSave, onToggleArchive, onDelete, onClose }: GoalEditSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="目标设置">
      <GoalEditForm goal={goal} active={open} onSave={onSave} onToggleArchive={onToggleArchive} onDelete={onDelete} />
    </Sheet>
  );
}
