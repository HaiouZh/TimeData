import { SwipeableListItem, SwipeAction, LeadingActions, TrailingActions } from "@meauxt/react-swipeable-list";
import type { Task } from "@timedata/shared";
import { isDueNow } from "../../lib/tasks/recurrence.js";

export function SwipeableTaskRow({
  task, pool, overdue, onToggle, onEdit, onDelete, onToToday, onToInbox,
}: {
  task: Task; pool: "today" | "inbox" | "upcoming";
  overdue?: boolean;
  onToggle: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
  onToToday: (t: Task) => void; onToInbox: (t: Task) => void;
}) {
  const canSwap = task.recurrence === null; // 重复任务不参与换池
  const checked = task.recurrence ? !isDueNow(task.recurrence, task.lastDoneAt, task.startAt) : task.done;

  const leading = canSwap && pool === "inbox" ? (
    <LeadingActions>
      <SwipeAction onClick={() => onToToday(task)}>
        <div className="flex h-full items-center bg-sky-700 px-4 text-sm font-medium text-white">排进今天</div>
      </SwipeAction>
    </LeadingActions>
  ) : canSwap && pool === "upcoming" ? (
    <LeadingActions>
      <SwipeAction onClick={() => onToToday(task)}>
        <div className="flex h-full items-center bg-sky-700 px-4 text-sm font-medium text-white">移到今天</div>
      </SwipeAction>
    </LeadingActions>
  ) : undefined;

  const trailing = (
    <TrailingActions>
      {canSwap && pool === "today" && (
        <SwipeAction onClick={() => onToInbox(task)}>
          <div className="flex h-full items-center bg-slate-700 px-4 text-sm font-medium text-white">回 inbox</div>
        </SwipeAction>
      )}
      <SwipeAction destructive onClick={() => onDelete(task)}>
        <div className="flex h-full items-center bg-rose-700 px-4 text-sm font-medium text-white">删除</div>
      </SwipeAction>
    </TrailingActions>
  );

  return (
    <SwipeableListItem leadingActions={leading} trailingActions={trailing}>
      <div className={`flex w-full items-start gap-3 rounded-lg border p-3 ${overdue ? "border-amber-800/60 bg-slate-900/80" : "border-slate-800 bg-slate-900/70"}`}>
        <input
          type="checkbox"
          aria-label={`完成 ${task.title}`}
          checked={checked}
          onChange={() => onToggle(task)}
          className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
        />
        <div className="min-w-0 flex-1" onClick={() => onEdit(task)} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") onEdit(task); }}>
          <div className={`break-words text-sm font-medium ${task.done || checked ? "text-slate-500 line-through" : "text-slate-100"}`}>
            {task.title}
          </div>
        </div>
      </div>
    </SwipeableListItem>
  );
}
