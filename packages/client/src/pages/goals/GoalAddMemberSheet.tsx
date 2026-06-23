import type { GoalMemberRef, Task, Track } from "@timedata/shared";
import { useMemo, useState, type FormEvent } from "react";
import { SelectSheet, type SelectOption } from "../../components/ui/SelectSheet.js";
import { Sheet } from "../../components/ui/Sheet.js";

export interface GoalAddMemberSheetProps {
  open: boolean;
  tasks: Task[];
  tracks: Track[];
  members: GoalMemberRef[];
  onAddMember: (ref: GoalMemberRef) => void | Promise<void>;
  onQuickCreateTask: (title: string) => void | Promise<void>;
  onClose: () => void;
}

function memberKey(ref: GoalMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

function taskOption(task: Task): SelectOption<string> {
  return { value: task.id, label: task.title };
}

function trackOption(track: Track): SelectOption<string> {
  return { value: track.id, label: track.title };
}

export function GoalAddMemberSheet({
  open,
  tasks,
  tracks,
  members,
  onAddMember,
  onQuickCreateTask,
  onClose,
}: GoalAddMemberSheetProps) {
  const [quickTitle, setQuickTitle] = useState("");
  const memberKeys = useMemo(() => new Set(members.map(memberKey)), [members]);
  const taskOptions = useMemo(
    () => tasks.filter((task) => !memberKeys.has(`task:${task.id}`)).map(taskOption),
    [memberKeys, tasks],
  );
  const trackOptions = useMemo(
    () => tracks.filter((track) => !memberKeys.has(`track:${track.id}`)).map(trackOption),
    [memberKeys, tracks],
  );

  function submitQuickCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    void onQuickCreateTask(title);
    setQuickTitle("");
  }

  return (
    <Sheet open={open} onClose={onClose} title="添加成员">
      <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
        <SelectSheet
          label="添加任务成员"
          placeholder="选择任务"
          value={null}
          options={taskOptions}
          onChange={(id) => {
            void onAddMember({ kind: "task", id });
          }}
        />
        <SelectSheet
          label="添加轨道成员"
          placeholder="选择轨道"
          value={null}
          options={trackOptions}
          onChange={(id) => {
            void onAddMember({ kind: "track", id });
          }}
        />
      </div>
      <form
        onSubmit={submitQuickCreate}
        className="flex items-center gap-2 border-t border-border-hairline px-4 py-3"
      >
        <input
          type="text"
          aria-label="新建任务并加入"
          value={quickTitle}
          onChange={(event) => setQuickTitle(event.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-row border border-border bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          placeholder="新建任务并加入"
        />
        <button
          type="submit"
          className="min-h-11 rounded-ctl bg-accent px-4 text-sm font-medium text-page hover:bg-accent-strong"
        >
          加入
        </button>
      </form>
    </Sheet>
  );
}
