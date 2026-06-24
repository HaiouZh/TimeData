import type { GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { Sheet } from "../../components/ui/Sheet.js";
import { GoalMemberPicker } from "./GoalMemberPicker.js";

export interface GoalAddMemberSheetProps {
  open: boolean;
  tasks: Task[];
  tracks: Track[];
  steps: TrackStep[];
  members: GoalMemberRef[];
  boardSignals: readonly string[];
  archived: boolean;
  onAddMember: (ref: GoalMemberRef) => void | Promise<void>;
  onQuickCreateTask: (title: string) => void | Promise<void>;
  onClose: () => void;
}

export function GoalAddMemberSheet({
  open,
  tasks,
  tracks,
  steps,
  members,
  boardSignals,
  archived,
  onAddMember,
  onQuickCreateTask,
  onClose,
}: GoalAddMemberSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="添加成员">
      <GoalMemberPicker
        tasks={tasks}
        tracks={tracks}
        steps={steps}
        members={members}
        boardSignals={boardSignals}
        archived={archived}
        onAddMember={onAddMember}
        onQuickCreateTask={onQuickCreateTask}
      />
    </Sheet>
  );
}
