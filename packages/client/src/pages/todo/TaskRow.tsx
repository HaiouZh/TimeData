import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useState } from "react";
import type { Task, TaskSubtask } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { isDueNow } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { SubtaskEditor } from "./SubtaskEditor.js";
import { useSubtaskDraft } from "./useSubtaskDraft.js";

export type TaskPool = "today" | "inbox" | "upcoming" | "recurring";

export interface RowDragHandle {
  setActivatorNodeRef: (el: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
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
  onSubtasksChange: (task: Task, next: TaskSubtask[]) => void;
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

function InlineSubtasks({
  task,
  seedEmpty,
  onCommit,
}: {
  task: Task;
  seedEmpty: boolean;
  onCommit: (next: TaskSubtask[]) => void;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次展开都会重新挂载，这里只播种一次
  const initial = useMemo<TaskSubtask[]>(() => {
    const current = task.subtasks ?? [];
    if (seedEmpty && current.length === 0) return [{ id: uuid(), title: "", done: false }];
    return current;
  }, []);
  const { subtasks, onChange, onBlur } = useSubtaskDraft({
    taskId: task.id,
    externalSubtasks: initial,
    onCommit,
  });
  const autoFocusId = seedEmpty && initial.length === 1 ? initial[0].id : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: onBlur 仅用于提交子任务草稿
    <div className="ml-9 pb-1" onBlur={onBlur}>
      <SubtaskEditor value={subtasks} onChange={onChange} density="compact" autoFocusId={autoFocusId} />
    </div>
  );
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
  onSubtasksChange,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [seedEmpty, setSeedEmpty] = useState(false);
  const isRecurring = task.recurrence !== null;
  const checked = task.recurrence ? !isDueNow(task.recurrence, task.lastDoneAt, task.startAt) : task.done;
  const canMove = !isRecurring && pool !== "recurring";
  const subtasks = task.subtasks ?? [];
  const subtaskTotal = subtasks.length;
  const subtaskDone = subtasks.filter((subtask) => subtask.done).length;
  const overdueDate = overdue && task.scheduledAt ? task.scheduledAt : null;
  const hasMeta = isRecurring || subtaskTotal > 0 || overdueDate !== null;
  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (window.getSelection()?.toString()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rowClickZone(event.clientX - rect.left, rect.width, subtaskTotal > 0) === "expand") {
      setSeedEmpty(false);
      setExpanded((value) => !value);
      return;
    }
    onEdit(task);
  }

  return (
    <div className="group rounded-row transition hover:bg-surface-hover">
      <div
        className="flex items-center gap-3 px-2 py-2"
        role="link"
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
        {subtaskTotal > 0 ? (
          <button
            type="button"
            aria-label={expanded ? "收起子任务" : "展开子任务"}
            onClick={(event) => {
              event.stopPropagation();
              setSeedEmpty(false);
              setExpanded((value) => !value);
            }}
            className="shrink-0 rounded-ctl px-1 text-xs text-ink-3 hover:bg-surface-hover hover:text-ink-2"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : expanded ? (
          <button
            type="button"
            aria-label="收起子任务"
            onClick={(event) => {
              event.stopPropagation();
              setSeedEmpty(false);
              setExpanded(false);
            }}
            className="shrink-0 rounded-ctl px-1 text-xs text-ink-3 hover:bg-surface-hover hover:text-ink-2"
          >
            ▾
          </button>
        ) : (
          <button
            type="button"
            aria-label="添加子任务"
            onClick={(event) => {
              event.stopPropagation();
              setSeedEmpty(true);
              setExpanded(true);
            }}
            className="shrink-0 rounded-ctl px-1 text-xs text-ink-3 opacity-0 transition hover:bg-surface-hover hover:text-ink-2 group-hover:opacity-100"
          >
            +
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
        {dragHandle && (
          <button
            ref={dragHandle.setActivatorNodeRef}
            type="button"
            aria-label={`拖动 ${task.title}`}
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 cursor-grab touch-none select-none rounded-ctl px-1 text-ink-3 hover:text-ink-2 active:cursor-grabbing"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            ⠿
          </button>
        )}
      </div>
      {expanded && (
        <InlineSubtasks
          task={task}
          seedEmpty={seedEmpty}
          onCommit={(next) => onSubtasksChange(task, next)}
        />
      )}
    </div>
  );
}
