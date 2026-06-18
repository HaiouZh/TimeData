import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import type { Task, TaskSubtask } from "@timedata/shared";
import { type MouseEvent as ReactMouseEvent, useMemo, useState } from "react";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { currentDueDateString, isDueNow } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { taskTimeLabel } from "../../lib/tasks/taskTimeLabel.js";
import { TURN_DOT_BG, TURN_LABELS } from "../../lib/tasks/turnTags.js";
import { formatMonthDay } from "../../lib/time.js";
import { SubtaskEditor } from "./SubtaskEditor.js";
import { useSubtaskDraft } from "./useSubtaskDraft.js";

export type TaskPool = "today" | "inbox" | "upcoming" | "recurring" | "completed";

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
  onSubtasksChange: (task: Task, next: TaskSubtask[]) => void;
  onTurnChange?: (task: Task, turn: Task["turn"]) => void;
  turnBadgeInteractive?: boolean;
}

function InlineSubtasks({
  task,
  onCommit,
}: {
  task: Task;
  onCommit: (next: TaskSubtask[]) => void;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次展开都会重新挂载，这里只读取一次
  const initial = useMemo<TaskSubtask[]>(() => task.subtasks ?? [], []);
  const { subtasks, onChange, onBlur } = useSubtaskDraft({
    taskId: task.id,
    externalSubtasks: initial,
    onCommit,
  });

  return (
    <div className="ml-9 pb-1" onBlur={onBlur}>
      <SubtaskEditor value={subtasks} onChange={onChange} density="compact" />
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
  onSubtasksChange,
  onTurnChange,
  turnBadgeInteractive,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isRecurring = task.recurrence !== null;
  const checked = task.recurrence ? !isDueNow(task.recurrence, task.lastDoneAt, task.startAt) : task.done;
  const subtasks = task.subtasks ?? [];
  const subtaskTotal = subtasks.length;
  const subtaskDone = subtasks.filter((subtask) => subtask.done).length;
  const overdueDate =
    overdue && task.recurrence ? currentDueDateString(task.recurrence, task.lastDoneAt, task.startAt) : null;
  const passiveScheduled = pool === "upcoming" && !overdue;
  const hasMeta =
    isRecurring ||
    subtaskTotal > 0 ||
    overdueDate !== null ||
    passiveScheduled ||
    task.turn !== null ||
    (task.tags ?? []).length > 0;

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (window.getSelection()?.toString()) return;
    // 有子任务时左 2/5 命中区展开，其余打开抽屉；无子任务整行恒打开抽屉（加子任务也走抽屉）。
    const rect = event.currentTarget.getBoundingClientRect();
    if (rowClickZone(event.clientX - rect.left, rect.width, subtaskTotal > 0) === "expand") {
      setExpanded((value) => !value);
      return;
    }
    onEdit(task);
  }

  return (
    <div className="group w-full rounded-row transition hover:bg-surface-hover">
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
        {/* 复选框 + 折叠指示器：caret 是纯展示 <span>，落在行左 2/5 命中区内，
            点它经行 onClick + rowClickZone 仍展开；不再有独立 onClick / stopPropagation。 */}
        <div className="flex shrink-0 items-center gap-1">
          <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              ariaLabel={`完成 ${task.title}`}
              checked={checked}
              onChange={() => onToggle(task)}
              className="shrink-0"
            />
          </div>
          {subtaskTotal > 0 && (
            <span
              data-testid="subtask-caret"
              aria-hidden="true"
              className="w-3 shrink-0 text-center text-[10px] text-ink-3"
            >
              {expanded ? "▾" : "▸"}
            </span>
          )}
        </div>
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
              {passiveScheduled && <span>{taskTimeLabel(task)}</span>}
              {task.turn && (
                <span
                  data-testid="turn-badge"
                  data-turn={task.turn}
                  className="inline-flex items-center gap-1"
                  onClick={
                    turnBadgeInteractive
                      ? (event) => {
                          event.stopPropagation();
                          onTurnChange?.(task, task.turn);
                        }
                      : undefined
                  }
                >
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-pill ${TURN_DOT_BG[task.turn]}`} />
                  {TURN_LABELS[task.turn]}
                </span>
              )}
              {(task.tags ?? []).slice(0, 3).map((tag) => (
                <span key={tag} data-testid="tag-chip" className="rounded-pill bg-surface-hover px-1.5 py-0.5 text-ink-2">
                  #{tag}
                </span>
              ))}
              {(task.tags ?? []).length > 3 && <span>…</span>}
            </div>
          )}
        </div>
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
      {expanded && subtaskTotal > 0 && (
        <InlineSubtasks task={task} onCommit={(next) => onSubtasksChange(task, next)} />
      )}
    </div>
  );
}