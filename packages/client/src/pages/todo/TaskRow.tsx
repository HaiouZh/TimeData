import type { ReactNode } from "react";
import type { Task } from "@timedata/shared";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { isDueNow } from "../../lib/tasks/recurrence.js";

export type TaskPool = "today" | "inbox" | "upcoming" | "recurring";

export interface TaskRowProps {
  task: Task;
  pool: TaskPool;
  overdue?: boolean;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
}

function HoverAction({ label, onClick, children, danger }: {
  label: string; onClick: () => void; children: ReactNode; danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`hidden h-8 w-8 items-center justify-center rounded-lg text-sm opacity-0 transition group-hover:opacity-100 sm:flex ${
        danger ? "text-rose-300 hover:bg-rose-900/40" : "text-slate-400 hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

export function TaskRow({ task, pool, overdue, onToggle, onEdit, onDelete, onToToday, onToInbox }: TaskRowProps) {
  const isRecurring = task.recurrence !== null;
  const checked = task.recurrence
    ? !isDueNow(task.recurrence, task.lastDoneAt, task.startAt)
    : task.done;
  const canMove = !isRecurring && pool !== "recurring";

  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-slate-800/70">
      <Checkbox ariaLabel={`完成 ${task.title}`} checked={checked} onChange={() => onToggle(task)} className="shrink-0" />
      <div
        className="min-w-0 flex-1"
        role="button"
        tabIndex={0}
        onClick={() => onEdit(task)}
        onKeyDown={(e) => { if (e.key === "Enter") onEdit(task); }}
      >
        <span className={`break-words text-sm ${checked ? "text-slate-500 line-through" : "text-slate-100"}`}>
          {task.title}
        </span>
        {isRecurring && (
          <span data-icon="repeat" aria-hidden="true" className="ml-1.5 text-xs text-slate-500">↻</span>
        )}
      </div>
      {overdue && (
        <span className="shrink-0 rounded-md border border-amber-500/40 px-1.5 py-0.5 text-[11px] text-amber-300">
          逾期
        </span>
      )}
      {canMove && (pool === "inbox" || pool === "upcoming") && (
        <HoverAction label="排进今天" onClick={() => onToToday(task)}>↑</HoverAction>
      )}
      {canMove && pool === "today" && (
        <HoverAction label="回收件箱" onClick={() => onToInbox(task)}>↩</HoverAction>
      )}
      {canMove && (
        <HoverAction label="删除" danger onClick={() => onDelete(task)}>✕</HoverAction>
      )}
    </div>
  );
}
