import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import {
  ArrowLeft,
  ArrowRight,
  CalendarBlank,
  CaretDown,
  CaretRight,
  DotsSixVertical,
  HandGrabbing,
  ListChecks,
  Repeat,
  Trash,
} from "@phosphor-icons/react";
import { nextDueDate, type Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { db } from "../../db/index.js";
import { currentDueDateString, recurrenceSummary } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { taskDueDateLabel } from "../../lib/tasks/taskTimeLabel.js";
import { projectTemplateChildren } from "../../lib/tasks/templateChildrenProjection.js";
import { tagColor } from "../../lib/tasks/turnTags.js";
import { formatYearAwareMonthDay, getDateString } from "../../lib/time.js";
import { InlineChildren, type InlineChildrenMode } from "./InlineChildren.js";
import { SubtaskOutline } from "./SubtaskOutline.js";
import { useLatestOccurrenceChildren } from "./useLatestOccurrenceChildren.js";
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
  onToHand?: (t: Task) => void;
  /** 只读场景强制覆盖按 pool 推断的 children mode。 */
  childrenModeOverride?: InlineChildrenMode;
  /** 行内额外动作插槽（如翻牌「顶一下」）；UI 按钮自带 stopPropagation。 */
  extraAction?: (task: Task) => ReactNode;
  indentTargetActive?: boolean;
  revealChildren?: { id: string; nonce: number } | null;
  /** 该任务已归入某个 active 目标：渲染常驻外圈，提示「已有去处、不必再纠结」。 */
  inGoal?: boolean;
}

const FRESH_OCCURRENCE_MS = 4000;
const RULE_COMPLETE_FLASH_MS = 1000;

/**
 * meta 胶囊统一底盘。底色用 surface-elevated 而非 surface-hover：后者与行 hover/缩进高亮同色，
 * 悬停时胶囊边界会整体隐形。文字色由各胶囊追加（text-ink-2 / 逾期 text-danger），
 * 不放进底盘避免同属性 utility 冲突。
 */
const META_CHIP_CLASS = "inline-flex items-center gap-1 rounded-pill bg-surface-elevated px-1.5 py-px";

type FreshOccurrenceInput = Pick<Task, "createdAt" | "done" | "recurrence" | "ruleId" | "skipped">;

function childModeForPool(pool: TaskPool): InlineChildrenMode {
  if (pool === "completed") return "readonly";
  if (pool === "upcoming") return "static";
  return "draggable";
}

function isFreshPendingOccurrence(task: FreshOccurrenceInput, nowMs = Date.now()): boolean {
  if (task.ruleId === null || task.recurrence !== null || task.done || task.skipped) return false;
  const createdMs = Date.parse(task.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  const ageMs = nowMs - createdMs;
  return ageMs >= 0 && ageMs < FRESH_OCCURRENCE_MS;
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
  onToHand,
  childrenModeOverride,
  extraAction,
  indentTargetActive,
  revealChildren,
  inGoal,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const taskCreatedAt = task.createdAt;
  const taskDone = task.done;
  const taskRecurrence = task.recurrence;
  const taskRuleId = task.ruleId;
  const taskSkipped = task.skipped;
  const [freshOccurrence, setFreshOccurrence] = useState(() =>
    isFreshPendingOccurrence({
      createdAt: taskCreatedAt,
      done: taskDone,
      recurrence: taskRecurrence,
      ruleId: taskRuleId,
      skipped: taskSkipped,
    }),
  );
  const children = useTaskChildren(task.id);
  const processedOccurrences =
    useLiveQuery(
      () => (task.recurrence ? db.tasks.where("ruleId").equals(task.id).toArray() : Promise.resolve([] as Task[])),
      [task.id, task.recurrence !== null],
      [] as Task[],
    ) ?? [];
  const isRecurring = task.recurrence !== null;
  // 规则行勾选=代理完成「最新一发」；未到期时也允许人工提前完成，无下一发（耗尽）才置灰。
  // 勾完最新一发会即时物化下一发，用短暂已勾反馈盖住"勾了弹回"。
  const [ruleJustCompleted, setRuleJustCompleted] = useState(false);
  const ruleFlashTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (ruleFlashTimer.current != null) window.clearTimeout(ruleFlashTimer.current);
    },
    [],
  );
  const checked = task.recurrence ? ruleJustCompleted : task.done;
  const ruleCanComplete =
    isRecurring &&
    (processedOccurrences.some((o) => !o.done && !o.skipped) ||
      nextDueDate(task, processedOccurrences, new Date()) != null);
  const childTotal = children.length;
  const { latestOccurrence, occurrenceChildren } = useLatestOccurrenceChildren(isRecurring ? task : null);
  const childDone = isRecurring
    ? projectTemplateChildren(children, latestOccurrence, occurrenceChildren).filter((entry) => entry.effectiveDone)
        .length
    : children.filter((c) => c.done).length;
  // 耗尽规则（不可勾）不画描边：描边在 Checkbox 的 label 外，不吃 disabled 的 opacity-40，
  // frameless 又藏掉调暗的边框，否则禁用复选框会顶着一圈全亮描边、看似可点。
  const outlineActive = childTotal > 0 && !checked && (!isRecurring || ruleCanComplete);
  const overdueDate = overdue
    ? task.recurrence
      ? currentDueDateString(task.recurrence, task.lastDoneAt, task.startAt)
      : task.ruleId !== null && task.scheduledAt !== null
        ? getDateString(new Date(task.scheduledAt))
        : null
    : null;
  const passiveScheduled = pool === "upcoming" && !overdue;
  const passiveDueLabel = passiveScheduled ? taskDueDateLabel(task, processedOccurrences) : null;
  const dateChip = overdueDate
    ? { label: formatYearAwareMonthDay(overdueDate), danger: true }
    : passiveDueLabel
      ? { label: passiveDueLabel, danger: false }
      : null;
  // isRecurring 兜住"重复但耗尽无日期"的场景（此时 dateChip 为 null 但 repeat 胶囊仍要渲染）。
  const hasMeta = isRecurring || childTotal > 0 || dateChip !== null || (task.tags ?? []).length > 0;
  const canSwapPool = task.recurrence === null && pool !== "completed";
  const canGrab = task.recurrence === null && pool !== "completed";
  const childrenMode = childrenModeOverride ?? childModeForPool(pool);
  const showInlineChildren = expanded && childTotal > 0;
  const extraActionNode = extraAction?.(task);

  useEffect(() => {
    if (revealChildren != null && revealChildren.id === task.id) setExpanded(true);
  }, [revealChildren, task.id]);

  useEffect(() => {
    const freshInput = {
      createdAt: taskCreatedAt,
      done: taskDone,
      recurrence: taskRecurrence,
      ruleId: taskRuleId,
      skipped: taskSkipped,
    };
    if (!isFreshPendingOccurrence(freshInput)) {
      setFreshOccurrence(false);
      return;
    }

    const remainingMs = Math.max(0, FRESH_OCCURRENCE_MS - (Date.now() - Date.parse(taskCreatedAt)));
    setFreshOccurrence(true);
    const timeoutId = window.setTimeout(() => setFreshOccurrence(false), remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [taskCreatedAt, taskDone, taskRecurrence, taskRuleId, taskSkipped]);

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
      data-in-goal={inGoal ? "true" : undefined}
      data-fresh-occurrence={freshOccurrence ? "true" : undefined}
      className={`group w-full rounded-row bg-surface transition hover:bg-surface-hover ${
        indentTargetActive ? "bg-surface-hover ring-1 ring-accent" : ""
      } ${freshOccurrence ? "todo-occurrence-fresh" : ""}`}
    >
      <div
        className="relative flex items-center gap-1.5 px-2 py-1"
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
        {inGoal && (
          <span
            data-testid="goal-linked-bar"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-1.5 left-0 z-20 w-1 rounded-r-sm bg-ok"
          />
        )}
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
              onChange={() => {
                if (!isRecurring) {
                  onToggle(task);
                  return;
                }
                if (!ruleCanComplete) return;
                setRuleJustCompleted(true);
                if (ruleFlashTimer.current != null) window.clearTimeout(ruleFlashTimer.current);
                ruleFlashTimer.current = window.setTimeout(() => setRuleJustCompleted(false), RULE_COMPLETE_FLASH_MS);
                onToggle(task);
              }}
              disabled={isRecurring && !ruleCanComplete}
              className="shrink-0"
              frameless={outlineActive}
            />
            {outlineActive && <SubtaskOutline total={childTotal} done={childDone} />}
          </div>
          <span
            data-testid={childTotal > 0 ? "subtask-caret" : "task-row-left-indicator"}
            aria-hidden="true"
            className="shrink-0 text-ink-3"
          >
            <Icon
              icon={childTotal > 0 ? (expanded ? CaretDown : CaretRight) : DotsSixVertical}
              size={childTotal > 0 ? 12 : 14}
            />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <span className={`select-text break-words text-sm ${checked ? "text-ink-3 line-through" : "text-ink"}`}>
            {task.title}
          </span>
          {hasMeta && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 td-text-caption text-ink-3">
              {task.recurrence && (
                <span data-testid="repeat-chip" className={`${META_CHIP_CLASS} text-ink-2`}>
                  <span data-icon="repeat" aria-hidden="true" className="text-accent">
                    <Icon icon={Repeat} size={12} />
                  </span>
                  {recurrenceSummary(task.recurrence)}
                </span>
              )}
              {dateChip && (
                <span
                  data-testid="date-chip"
                  data-danger={dateChip.danger ? "true" : undefined}
                  className={`${META_CHIP_CLASS} ${dateChip.danger ? "text-danger" : "text-ink-2"}`}
                >
                  <span aria-hidden="true">
                    <Icon icon={CalendarBlank} size={12} />
                  </span>
                  {dateChip.label}
                </span>
              )}
              {childTotal > 0 && (
                <span data-testid="subtask-chip" className={`${META_CHIP_CLASS} text-ink-2`}>
                  <span aria-hidden="true">
                    <Icon icon={ListChecks} size={12} />
                  </span>
                  {childDone}/{childTotal}
                </span>
              )}
              {(task.tags ?? []).slice(0, 3).map((tag) => (
                <span key={tag} data-testid="tag-chip" className={`${META_CHIP_CLASS} text-ink-2`}>
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
          <div className="pointer-events-none absolute inset-y-0 right-2 z-20 my-auto flex h-6 items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
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
            {canGrab && onToHand && (
              <button
                type="button"
                aria-label={`抓到手头 ${task.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToHand(task);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-accent"
              >
                <Icon icon={HandGrabbing} size={16} />
              </button>
            )}
            {extraActionNode}
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
        {coarsePointer !== false && extraActionNode && (
          <div className="relative z-20 ml-1 flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
            {extraActionNode}
          </div>
        )}
      </div>
      {showInlineChildren && (
        <div className="ml-9 pb-1" onClick={(event) => event.stopPropagation()}>
          <InlineChildren parentId={task.id} mode={childrenMode} />
        </div>
      )}
    </div>
  );
}
