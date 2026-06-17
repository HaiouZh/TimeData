import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import type { Task, TaskSubtask } from "@timedata/shared";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { AnchoredPopover } from "../../components/ui/AnchoredPopover.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { isDueNow } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { taskTimeLabel } from "../../lib/tasks/taskTimeLabel.js";
import { TURN_DOT_BG, TURN_LABELS, TURN_SEGMENTED_OPTIONS } from "../../lib/tasks/turnTags.js";
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
  wide?: boolean;
  showActions?: boolean;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onEditSchedule?: (t: Task, el: HTMLElement) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
  onSubtasksChange: (task: Task, next: TaskSubtask[]) => void;
  onTurnChange?: (task: Task, turn: Task["turn"]) => void;
  turnBadgeInteractive?: boolean;
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
  wide,
  showActions = true,
  onToggle,
  onEdit,
  onEditSchedule,
  onDelete,
  onToToday,
  onToInbox,
  onSubtasksChange,
  onTurnChange,
  turnBadgeInteractive,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [seedEmpty, setSeedEmpty] = useState(false);
  const [turnMenuOpen, setTurnMenuOpen] = useState(false);
  const turnAnchorRef = useRef<HTMLButtonElement>(null);
  const isRecurring = task.recurrence !== null;
  const checked = task.recurrence ? !isDueNow(task.recurrence, task.lastDoneAt, task.startAt) : task.done;
  const canMove = showActions && !isRecurring && pool !== "recurring";
  // 收件箱里的任务视为「无生效排期」：过期回库后残留的 scheduledAt 不当作日期 chip 显示。
  const hasActiveSchedule = isRecurring || (task.scheduledAt !== null && pool !== "inbox");
  const subtasks = task.subtasks ?? [];
  const subtaskTotal = subtasks.length;
  const subtaskDone = subtasks.filter((subtask) => subtask.done).length;
  const overdueDate = overdue && task.scheduledAt ? task.scheduledAt : null;
  const hasMeta =
    isRecurring || subtaskTotal > 0 || overdueDate !== null || task.turn !== null || (task.tags ?? []).length > 0;
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
        {/* 复选框 + 展开箭头紧贴成一簇；箭头只作指示，展开命中靠行左 2/5 区域。 */}
        <div className="flex shrink-0 items-center gap-1">
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
              className="w-4 shrink-0 rounded-ctl px-0 text-center text-xs text-ink-3 hover:bg-surface-hover hover:text-ink-2"
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
              className="w-4 shrink-0 rounded-ctl px-0 text-center text-xs text-ink-3 hover:bg-surface-hover hover:text-ink-2"
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
              className="w-4 shrink-0 rounded-ctl px-0 text-center text-xs text-ink-3 opacity-0 transition hover:bg-surface-hover hover:text-ink-2 group-hover:opacity-100"
            >
              +
            </button>
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
        {showActions && wide && task.turn === null && (
          <HoverAction label="纳入回合" onClick={() => onTurnChange?.(task, "me")}>
            纳
          </HoverAction>
        )}
        {showActions && wide && task.turn !== null && (
          <button
            ref={turnAnchorRef}
            type="button"
            aria-label="切换回合"
            onClick={(event) => {
              event.stopPropagation();
              setTurnMenuOpen((v) => !v);
            }}
            className="hidden h-8 w-8 items-center justify-center rounded-ctl text-sm opacity-0 transition group-hover:opacity-100 sm:flex text-ink-3 hover:bg-surface-hover"
          >
            转
          </button>
        )}
        {showActions &&
          wide &&
          (hasActiveSchedule ? (
            <button
              type="button"
              aria-label="编辑重复与时间"
              onClick={(event) => {
                event.stopPropagation();
                onEditSchedule?.(task, event.currentTarget);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className="shrink-0 rounded-ctl bg-surface-hover px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-elevated"
            >
              {taskTimeLabel(task)}
            </button>
          ) : (
            !isRecurring && (
              <button
                type="button"
                aria-label="计划到某天"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditSchedule?.(task, event.currentTarget);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="hidden shrink-0 rounded-ctl px-2 py-0.5 text-xs text-ink-3 opacity-0 transition hover:bg-surface-hover group-hover:inline group-hover:opacity-100"
              >
                设定
              </button>
            )
          ))}
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
        <InlineSubtasks task={task} seedEmpty={seedEmpty} onCommit={(next) => onSubtasksChange(task, next)} />
      )}
      <AnchoredPopover
        open={turnMenuOpen}
        anchorRef={turnAnchorRef}
        ariaLabel="回合切换"
        onClose={() => setTurnMenuOpen(false)}
        className="w-64 rounded-card border border-border-hairline bg-surface-elevated p-2"
      >
        <div className="space-y-2">
          <SegmentedControl
            ariaLabel="回合"
            options={TURN_SEGMENTED_OPTIONS}
            value={task.turn ?? "me"}
            onChange={(value) => {
              onTurnChange?.(task, value);
              setTurnMenuOpen(false);
            }}
          />
          <button
            type="button"
            aria-label="退出流程"
            onClick={() => {
              onTurnChange?.(task, null);
              setTurnMenuOpen(false);
            }}
            className="w-full rounded-ctl px-2 py-1 text-xs text-ink-3 hover:bg-surface-hover"
          >
            退出流程
          </button>
        </div>
      </AnchoredPopover>
    </div>
  );
}
