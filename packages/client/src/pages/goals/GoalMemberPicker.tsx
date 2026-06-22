import { X } from "@phosphor-icons/react";
import type { Task, Track } from "@timedata/shared";
import { Icon } from "../../components/Icon.js";
import { SelectSheet, type SelectOption } from "../../components/ui/SelectSheet.js";
import type { GoalMember, GoalMemberKind } from "../../lib/goalsView.js";

interface GoalMemberPickerProps {
  goalId: string;
  tasks: Task[];
  tracks: Track[];
  members: GoalMember[];
  onAssignTask: (taskId: string) => void;
  onAssignTrack: (trackId: string) => void;
  onRemoveMember: (kind: GoalMemberKind, id: string) => void;
}

function memberKindLabel(kind: GoalMemberKind): string {
  return kind === "task" ? "任务" : "轨道";
}

function taskOption(task: Task): SelectOption<string> {
  return { value: task.id, label: task.title };
}

function trackOption(track: Track): SelectOption<string> {
  return { value: track.id, label: track.title };
}

export function GoalMemberPicker({
  goalId,
  tasks,
  tracks,
  members,
  onAssignTask,
  onAssignTrack,
  onRemoveMember,
}: GoalMemberPickerProps) {
  const taskOptions = tasks.filter((task) => (task.goalId ?? null) !== goalId).map(taskOption);
  const trackOptions = tracks.filter((track) => (track.goalId ?? null) !== goalId).map(trackOption);

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">成员</h2>
        <span className="text-xs text-ink-3">{members.length} 个成员</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectSheet
          label="添加任务成员"
          placeholder="添加任务成员"
          value={null}
          options={taskOptions}
          onChange={onAssignTask}
        />
        <SelectSheet
          label="添加轨道成员"
          placeholder="添加轨道成员"
          value={null}
          options={trackOptions}
          onChange={onAssignTrack}
        />
      </div>
      {members.length === 0 ? (
        <p className="mt-3 rounded-row border border-dashed border-border-hairline px-3 py-4 text-center text-sm text-ink-3">
          还没有成员
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border-hairline">
          {members.map((member) => (
            <li key={`${member.kind}:${member.id}`} className="flex min-h-11 items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-ink">{member.title}</p>
                <p className="text-xs text-ink-3">{memberKindLabel(member.kind)}</p>
              </div>
              <button
                type="button"
                aria-label={`移出目标 ${member.title}`}
                onClick={() => onRemoveMember(member.kind, member.id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl bg-surface-elevated text-ink-3 hover:text-danger"
              >
                <Icon icon={X} size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
