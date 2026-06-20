import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, CaretDown, CaretRight, DotsSixVertical, Repeat, Trash } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { type MouseEvent as ReactMouseEvent, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { currentDueDateString } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { taskTimeLabel } from "../../lib/tasks/taskTimeLabel.js";
import { TURN_DOT_BG, TURN_LABELS } from "../../lib/tasks/turnTags.js";
import { formatMonthDay } from "../../lib/time.js";
import { InlineChildren, type InlineChildrenMode } from "./InlineChildren.js";
import { ParentDropZone } from "./ParentDropZone.js";
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
  onTurnChange?: (task: Task, turn: Task["turn"]) => void;
  turnBadgeInteractive?: boolean;
  /** 行写入后回调（InlineChildren 内部触发，宿主可在此调 syncAfterWrite）。 */
  onAfterChildWrite?: () => void;
  /** AttentionQueue 等场景强制只读，覆盖按 pool 推断的 mode。 */
  childrenModeOverride?: InlineChildrenMode;
  /**
   * 拖拽悬停意图激活：强制展开子任务区并渲染 parent 落点区（即便无子任务）。
   * 由顶层 TodoPage 的 hover-intent 状态驱动，仅拖拽期短暂为真。
   */
  dropActive?: boolean;
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
  onTurnChange,
  turnBadgeInteractive,
  onAfterChildWrite,
  childrenModeOverride,
  dropActive,
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
    task.turn !== null ||
    (task.tags ?? []).length > 0;
  const canSwapPool = task.recurrence === null && pool !== "completed";
  const overlayRightClass = dragHandle ? "right-8" : "right-2";
  const childrenMode = childrenModeOverride ?? childModeForPool(pool);
  // dropActive（拖拽悬停激活）强制展开；既有子任务照常列出，并额外渲染空 parent 落点区。
  const showInlineChildren = (expanded || dropActive === true) && childTotal > 0;
  const showDropZone = dropActive === true;

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
    <div className="group w-full rounded-row transition hover:bg-surface-hover">
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
        {/* 复选框 + caret：caret 紧贴 title，落在行左 2/5 命中区内，
            点它经行 onClick + rowClickZone 仍展开。 */}
        <div className="flex shrink-0 items-center gap-1">
          <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              ariaLabel={`完成 ${task.title}`}
              checked={checked}
              onChange={() => onToggle(task)}
              className="shrink-0"
            />
          </div>
          {childTotal > 0 && (
            <span data-testid="subtask-caret" aria-hidden="true" className="shrink-0 text-ink-3">
              <Icon icon={expanded ? CaretDown : CaretRight} size={12} />
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
                  <Icon icon={Repeat} size={14} />
                </span>
              )}
              {childTotal > 0 && (
                <span>
                  {childDone}/{childTotal}
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
                <span
                  key={tag}
                  data-testid="tag-chip"
                  className="rounded-pill bg-surface-hover px-1.5 py-0.5 text-ink-2"
                >
                  #{tag}
                </span>
              ))}
              {(task.tags ?? []).length > 3 && <span>…</span>}
            </div>
          )}
        </div>
        {coarsePointer === false && (
          <div
            className={`pointer-events-none absolute ${overlayRightClass} inset-y-0 z-10 my-auto flex h-6 items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100`}
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
            <Icon icon={DotsSixVertical} size={18} />
          </button>
        )}
      </div>
      {(showInlineChildren || showDropZone) && (
        <div className="ml-9 pb-1" onClick={(event) => event.stopPropagation()}>
          {showInlineChildren && (
            <InlineChildren parentId={task.id} mode={childrenMode} onAfterWrite={onAfterChildWrite} />
          )}
          {showDropZone && <ParentDropZone parentId={task.id} />}
        </div>
      )}
    </div>
  );
}