import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, CaretDown, CaretRight, DotsSixVertical, Repeat, Trash } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { currentDueDateString } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { taskTimeLabel } from "../../lib/tasks/taskTimeLabel.js";
import { tagColor } from "../../lib/tasks/turnTags.js";
import { formatYearAwareMonthDay } from "../../lib/time.js";
import { InlineChildren, type InlineChildrenMode } from "./InlineChildren.js";
import { useTaskChildren } from "./useTaskChildren.js";

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
  coarsePointer?: boolean;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete?: (t: Task) => void;
  onToToday?: (t: Task) => void;
  onToInbox?: (t: Task) => void;
  /** 行写入后回调（InlineChildren 内部触发，宿主可在此调 syncAfterWrite）。 */
  onAfterChildWrite?: () => void;
  /** 只读场景强制覆盖按 pool 推断的 children mode。 */
  childrenModeOverride?: InlineChildrenMode;
  indentTargetActive?: boolean;
  revealChildren?: { id: string; nonce: number } | null;
}

function childModeForPool(pool: TaskPool): InlineChildrenMode {
  if (pool === "completed") return "readonly";
  if (pool === "upcoming") return "static";
  return "draggable";
}

export function TaskRow({
  task,
  pool,
  overdue,
  dragHandle,
  coarsePointer,
  onToggle,
  onEdit,
  onDelete,
  onToToday,
  onToInbox,
  onAfterChildWrite,
  childrenModeOverride,
  indentTargetActive,
  revealChildren,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const children = useTaskChildren(task.id);
  const isRecurring = task.recurrence !== null;
  const checked = task.recurrence ? false : task.done;
  const childTotal = children.length;
  const childDone = children.filter((c) => c.done).length;
  const overdueDate =
    overdue && task.recurrence ? currentDueDateString(task.recurrence, task.lastDoneAt, task.startAt) : null;
  const passiveScheduled = pool === "upcoming" && !overdue;
  const hasMeta =
    isRecurring ||
    childTotal > 0 ||
    overdueDate !== null ||
    passiveScheduled ||
    (task.tags ?? []).length > 0;
  const canSwapPool = task.recurrence === null && pool !== "completed";
  const childrenMode = childrenModeOverride ?? childModeForPool(pool);
  const showInlineChildren = expanded && childTotal > 0;

  useEffect(() => {
    if (revealChildren != null && revealChildren.id === task.id) setExpanded(true);
  }, [revealChildren, task.id]);

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (window.getSelection()?.toString()) return;
    // 有子任务时左 2/5 命中区展开，其余打开抽屉；无子任务整行恒打开抽屉（加子任务也走抽屉）。
    const rect = event.currentTarget.getBoundingClientRect();
    if (rowClickZone(event.clientX - rect.left, rect.width, childTotal > 0) === "expand") {
      setExpanded((value) => !value);
      return;
    }
    onEdit(task);
  }

  return (
    <div
      className={`group w-full rounded-row transition hover:bg-surface-hover ${
        indentTargetActive ? "bg-surface-hover ring-1 ring-accent" : ""
      }`}
    >
      <div
        className="relative flex items-center gap-1.5 px-2 py-2"
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
        {dragHandle && (
          <button
            type="button"
            ref={dragHandle.setActivatorNodeRef}
            data-testid="task-row-grab-area"
            aria-label={`移动 ${task.title}`}
            className="absolute inset-y-0 left-0 z-10 w-2/5 cursor-grab touch-none select-none bg-transparent p-0 active:cursor-grabbing"
            onClick={(event) => {
              event.stopPropagation();
              if (window.getSelection()?.toString()) return;
              if (childTotal > 0) setExpanded((value) => !value);
              else onEdit(task);
            }}
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          />
        )}
        {/* 复选框 + caret：caret 紧贴 title，落在行左 2/5 命中区内，
            点它经行 onClick + rowClickZone 仍展开。 */}
        <div className="flex shrink-0 items-center gap-1">
          <div className="relative z-20 shrink-0" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              ariaLabel={`完成 ${task.title}`}
              checked={checked}
              onChange={() => onToggle(task)}
              className="shrink-0"
            />
          </div>
          <span
            data-testid={childTotal > 0 ? "subtask-caret" : "task-row-left-indicator"}
            aria-hidden="true"
            className="shrink-0 text-ink-3"
          >
            <Icon icon={childTotal > 0 ? (expanded ? CaretDown : CaretRight) : DotsSixVertical} size={childTotal > 0 ? 12 : 14} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <span className={`select-text break-words text-sm ${checked ? "text-ink-3 line-through" : "text-ink"}`}>
            {task.title}
          </span>
          {hasMeta && (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
              {isRecurring && (
                <span data-icon="repeat" aria-hidden="true">
                  <Icon icon={Repeat} size={14} />
                </span>
              )}
              {childTotal > 0 && (
                <span>
                  {childDone}/{childTotal}
                </span>
              )}
              {overdueDate && <span className="text-danger">{formatYearAwareMonthDay(overdueDate)}</span>}
              {passiveScheduled && <span>{taskTimeLabel(task)}</span>}
              {(task.tags ?? []).slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  data-testid="tag-chip"
                  className="inline-flex items-center gap-1 rounded-pill bg-surface-hover px-1.5 py-0.5 text-ink-2"
                >
                  <span
                    data-tag-dot
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tagColor(tag) }}
                  />
                  #{tag}
                </span>
              ))}
              {(task.tags ?? []).length > 3 && <span>…</span>}
            </div>
          )}
        </div>
        {coarsePointer === false && (
          <div
            className="pointer-events-none absolute inset-y-0 right-2 z-30 my-auto flex h-6 items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none -mr-2 h-6 w-6 bg-gradient-to-r from-transparent to-surface-hover"
            />
            {canSwapPool && pool === "today" && onToInbox && (
              <button
                type="button"
                aria-label={`回收件箱 ${task.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToInbox(task);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-ink"
              >
                <Icon icon={ArrowRight} size={16} />
              </button>
            )}
            {canSwapPool && (pool === "inbox" || pool === "upcoming") && onToToday && (
              <button
                type="button"
                aria-label={`排进今天 ${task.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToToday(task);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-ink"
              >
                <Icon icon={ArrowLeft} size={16} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                aria-label={`删除 ${task.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(task);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-danger"
              >
                <Icon icon={Trash} size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      {showInlineChildren && (
        <div className="ml-9 pb-1" onClick={(event) => event.stopPropagation()}>
          <InlineChildren parentId={task.id} mode={childrenMode} onAfterWrite={onAfterChildWrite} />
        </div>
      )}
    </div>
  );
}
