import { type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";
import type { Task } from "@timedata/shared";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { isDueNow } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";

export type TaskPool = "today" | "inbox" | "upcoming" | "recurring";

export interface RowDragHandle {
  setActivatorNodeRef: (el: HTMLElement | null) => void;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
}

export interface TaskRowProps {
  task: Task;
  pool: TaskPool;
  overdue?: boolean;
  dragHandle?: RowDragHandle;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
}

function HoverAction({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`hidden h-8 w-8 items-center justify-center rounded-ctl text-sm opacity-0 transition group-hover:opacity-100 sm:flex ${
        danger ? "text-danger hover:bg-danger-soft" : "text-ink-3 hover:bg-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}

function formatMonthDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function TaskRow({
  task,
  pool,
  overdue,
  dragHandle,
  onToggle,
  onEdit,
  onDelete,
  onToToday,
  onToInbox,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isRecurring = task.recurrence !== null;
  const checked = task.recurrence ? !isDueNow(task.recurrence, task.lastDoneAt, task.startAt) : task.done;
  const canMove = !isRecurring && pool !== "recurring";
  const subtasks = task.subtasks ?? [];
  const subtaskTotal = subtasks.length;
  const subtaskDone = subtasks.filter((subtask) => subtask.done).length;
  const overdueDate = overdue && task.scheduledAt ? task.scheduledAt : null;
  const hasMeta = isRecurring || subtaskTotal > 0 || overdueDate !== null;
  const dragHandleProps = dragHandle
    ? ({
        ...dragHandle.attributes,
        ...(dragHandle.listeners ?? {}),
      } as ButtonHTMLAttributes<HTMLButtonElement>)
    : null;

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (window.getSelection()?.toString()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rowClickZone(event.clientX - rect.left, rect.width, subtaskTotal > 0) === "expand") {
      setExpanded((value) => !value);
      return;
    }
    onEdit(task);
  }

  return (
    <div className="group rounded-row transition hover:bg-surface-hover">
      <div
        className="flex items-center gap-3 px-2 py-2"
        tabIndex={0}
        aria-label={`打开 ${task.title}`}
        onClick={handleRowClick}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEdit(task);
          }
        }}
      >
        <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            ariaLabel={`完成 ${task.title}`}
            checked={checked}
            onChange={() => onToggle(task)}
            className="shrink-0"
          />
        </div>
        {subtaskTotal > 0 && (
          <button
            type="button"
            aria-label={expanded ? "收起子任务" : "展开子任务"}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            className="shrink-0 rounded-ctl px-1 text-xs text-ink-3 hover:bg-surface-hover hover:text-ink-2"
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <span className={`select-text break-words text-sm ${checked ? "text-ink-3 line-through" : "text-ink"}`}>
            {task.title}
          </span>
          {hasMeta && (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
              {isRecurring && (
                <span data-icon="repeat" aria-hidden="true">
                  ↻
                </span>
              )}
              {subtaskTotal > 0 && (
                <span>
                  {subtaskDone}/{subtaskTotal}
                </span>
              )}
              {overdueDate && <span className="text-danger">逾期 {formatMonthDay(overdueDate)}</span>}
            </div>
          )}
        </div>
        {canMove && (pool === "inbox" || pool === "upcoming") && (
          <HoverAction label="排进今天" onClick={() => onToToday(task)}>
            ↑
          </HoverAction>
        )}
        {canMove && pool === "today" && (
          <HoverAction label="回收件箱" onClick={() => onToInbox(task)}>
            ↩
          </HoverAction>
        )}
        {canMove && (
          <HoverAction label="删除" danger onClick={() => onDelete(task)}>
            ✕
          </HoverAction>
        )}
        {dragHandle && dragHandleProps && (
          <button
            ref={dragHandle.setActivatorNodeRef}
            type="button"
            aria-label={`拖动 ${task.title}`}
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 cursor-grab touch-none select-none rounded-ctl px-1 text-ink-3 hover:text-ink-2 active:cursor-grabbing"
            {...dragHandleProps}
          >
            ⠿
          </button>
        )}
      </div>
      {expanded && subtaskTotal > 0 && (
        <ul className="ml-9 border-l border-border-hairline pb-1 pl-3">
          {subtasks.map((subtask) => (
            <li key={subtask.id} className="flex items-start gap-2 py-0.5">
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-xs text-ink-3">
                {subtask.done ? "☑" : "☐"}
              </span>
              <span
                className={`select-text break-words text-[13px] ${
                  subtask.done ? "text-ink-3 line-through" : "text-ink-2"
                }`}
              >
                {subtask.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
