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
import { copyText } from "../../quick-notes/clipboard.js";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { db } from "../../db/index.js";
import { contentTint } from "../../lib/contentTint.js";
import { currentDueDateString, recurrenceSummary } from "../../lib/tasks/recurrence.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { taskDueDateLabel } from "../../lib/tasks/taskTimeLabel.js";
import { projectTemplateChildren } from "../../lib/tasks/templateChildrenProjection.js";
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
  /** 标题被 Shift+单击复制成功后的上抛回调（反馈 toast 由宿主负责）。 */
  onCopyTitle?: (t: Task) => void;
  onDelete?: (t: Task) => void;
  onToToday?: (t: Task) => void;
  onToInbox?: (t: Task) => void;
  onToHand?: (t: Task) => void;
  /**
   * 这条已经在手头：不再渲染「抓到手头」入口——它已经在那儿了，点了也没有第二个手头可去。
   * 由调用方判定：手头是「sessionId 等于当前活跃场 id」，行拿不到活跃场（见 evergreen todo/at-hand）。
   */
  atHand?: boolean;
  /** 只读场景强制覆盖按 pool 推断的 children mode。 */
  childrenModeOverride?: InlineChildrenMode;
  /** 行内额外动作插槽（如翻牌「顶一下」）；UI 按钮自带 stopPropagation。 */
  extraAction?: (task: Task) => ReactNode;
  indentTargetActive?: boolean;
  revealChildren?: { id: string; nonce: number } | null;
  /** 该任务已归入某个 active 目标：渲染常驻外圈，提示「已有去处、不必再纠结」。 */
  inGoal?: boolean;
  /**
   * meta 胶囊带最前的一枚调用方胶囊：项目区行放「当前在哪」状态点，
   * 组外行放可点的项目名 chip。内容与交互（stopPropagation / 层级）由调用方自负，
   * TaskRow 只负责给位置并让 meta 带因它出现。
   */
  metaChip?: ReactNode;
  /**
   * 页面级多选态。开着时行点击 = 勾选（不再开详情），行的语义从 link 变 checkbox。
   * **复选框不受影响，仍然是「完成」**——两个动作同屏但不同位，见 design §动作一。
   */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (t: Task) => void;
  /** 透传给内部的子任务列表，见 `InlineChildren.dndIdPrefix`。 */
  dndIdPrefix?: string;
  /**
   * 这一行是「被挡着的」那一段的第一条：画一条上边框当分界。
   *
   * **分界刻意不是一个插在行之间的 DOM 节点**：组内行注册了 sortable，
   * `verticalListSortingStrategy` 按 DOM 顺序算位置，夹节点会扰乱拖拽计算；
   * 而行被第三方 `SwipeableListItem` 包着、DOM 兄弟结构由库决定，CSS 兄弟选择器同样不能用。
   */
  blockedBoundary?: boolean;
}

const FRESH_OCCURRENCE_MS = 4000;
const RULE_COMPLETE_FLASH_MS = 1000;

/**
 * meta 胶囊统一底盘。底色用 surface-elevated 而非 surface-hover：后者与行 hover/缩进高亮同色，
 * 悬停时胶囊边界会整体隐形。文字色由各胶囊追加（text-ink-2 / 逾期 text-danger），
 * 不放进底盘避免同属性 utility 冲突。
 */
export const META_CHIP_CLASS = "inline-flex items-center gap-1 rounded-pill bg-surface-elevated px-1.5 py-px";

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
  onCopyTitle,
  onDelete,
  onToToday,
  onToInbox,
  onToHand,
  atHand,
  childrenModeOverride,
  extraAction,
  indentTargetActive,
  revealChildren,
  inGoal,
  metaChip,
  selectionMode,
  selected,
  onToggleSelect,
  blockedBoundary,
  dndIdPrefix,
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
  const hasMeta =
    metaChip != null || isRecurring || childTotal > 0 || dateChip !== null || (task.tags ?? []).length > 0;
  // 与 TaskList.tsx 的左右滑判据（canSwap）对齐：occurrence 不进排期通道。
  const canSwapPool = task.recurrence === null && task.ruleId === null && pool !== "completed";
  // canGrab 刻意不加 ruleId：把「这一发」抓到手头是另一个动词，与排期无关，照常开放。
  // atHand 则是「已经在手头」——同一个动作对它是空动作，收掉。
  const canGrab = task.recurrence === null && pool !== "completed" && !atHand;
  const childrenMode = childrenModeOverride ?? childModeForPool(pool);
  const canInlineCompose = childTotal === 0 && childrenMode !== "readonly";
  const showInlineChildren = expanded && (childTotal > 0 || canInlineCompose);
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

  // 按下时快照展开态：空草稿行会在 pointerdown 之后、click 之前因失焦触发 onEmptyDismiss 收起，
  // 若 click 读的是彼时的 state，切换会被这次中间收起吃掉，行永远收不起来。
  const expandedAtPressRef = useRef(expanded);
  function captureExpandedAtPress(): void {
    expandedAtPressRef.current = expanded;
  }

  /** 左 2/5 进入子任务层：有子任务切展开，无子任务切草稿行。返回是否消费了这次点击。 */
  function toggleChildLayer(): boolean {
    if (childTotal === 0 && !canInlineCompose) return false;
    setExpanded(!expandedAtPressRef.current);
    return true;
  }

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (selectionMode) {
      onToggleSelect?.(task);
      return;
    }
    if (window.getSelection()?.toString()) return;
    // 左 2/5 统一进入子任务层；readonly 快照无子任务则保持开抽屉。
    const rect = event.currentTarget.getBoundingClientRect();
    if (rowClickZone(event.clientX - rect.left, rect.width) === "expand" && toggleChildLayer()) return;
    onEdit(task);
  }

  return (
    <div
      data-in-goal={inGoal ? "true" : undefined}
      data-indent-target={indentTargetActive ? "true" : undefined}
      data-fresh-occurrence={freshOccurrence ? "true" : undefined}
      data-blocked-boundary={blockedBoundary ? "true" : undefined}
      onPointerDownCapture={captureExpandedAtPress}
      className={`group w-full rounded-row bg-surface transition hover:bg-surface-hover ${
        blockedBoundary ? "mt-1.5 border-t border-border-hairline pt-1.5" : ""
      } ${indentTargetActive ? "bg-surface-hover ring-1 ring-accent" : ""} ${
        selectionMode && selected ? "bg-surface-hover ring-1 ring-accent" : ""
      } ${freshOccurrence ? "todo-occurrence-fresh" : ""}`}
    >
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role 是动态的，规则只按 link 那一支判；
          aria-checked 与 role="checkbox" 由同一个 selectionMode 三元同时开合，非多选态下是 undefined。 */}
      <div
        className="relative flex items-center gap-1.5 px-2 py-1"
        role={selectionMode ? "checkbox" : "link"}
        aria-checked={selectionMode ? Boolean(selected) : undefined}
        data-selected={selectionMode && selected ? "true" : undefined}
        tabIndex={0}
        aria-label={selectionMode ? `选择 ${task.title}` : `打开 ${task.title}`}
        onClick={handleRowClick}
        onKeyDown={(event) => {
          // 两支共用一道 target 闸：只认落在行本身的按键。行内嵌着真正的「完成」复选框，
          // 焦点在它上面按 Space 会先原生切换完成态、keydown 再冒泡上来——不挡的话一次按键
          // 同时「完成」+「勾选」。Enter 一并挡（原生 checkbox 不理 Enter，但拖柄按钮理），
          // 两支口径必须一致，否则下一个改这里的人只会照着有闸的那支抄。
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (selectionMode) {
              onToggleSelect?.(task);
              return;
            }
            onEdit(task);
            return;
          }
          // Space 才是 checkbox 的键盘约定键（原生 checkbox 对 Enter 毫无反应），多选态必须认它，
          // 否则键盘用户 Tab 到行按 Space 只会滚页面、一条都挑不中。preventDefault 挡的就是那次滚页。
          // **只在多选态生效**：非多选态行是 role="link"，那里 Space 本来就该滚页面。
          if (selectionMode && event.key === " ") {
            event.preventDefault();
            onToggleSelect?.(task);
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
            // 拖柄压在行左 2/5，与 iOS 左边缘返回的起手区重叠：标记让 EdgeSwipeBack 起手时沿链路
            // 遇到它即放弃，拖任务不会被返回抢走。只标拖柄本身——标到整行会把全行都挡住手势。
            data-edge-swipe-block=""
            aria-label={`移动 ${task.title}`}
            className="absolute inset-y-0 left-0 z-10 w-2/5 cursor-grab touch-none select-none bg-transparent p-0 active:cursor-grabbing"
            onClick={(event) => {
              event.stopPropagation();
              if (window.getSelection()?.toString()) return;
              // 纯 Shift+单击拖柄区=复制标题（与标题 span 同一守卫；拖柄只在非多选态渲染）
              if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                void copyText(task.title)
                  .then(() => onCopyTitle?.(task))
                  .catch(() => {});
                return;
              }
              if (!toggleChildLayer()) onEdit(task);
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
              icon={childTotal > 0 || (expanded && canInlineCompose) ? (expanded ? CaretDown : CaretRight) : DotsSixVertical}
              size={childTotal > 0 || (expanded && canInlineCompose) ? 12 : 14}
            />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`select-text break-words td-text-label ${checked ? "text-ink-3 line-through" : "text-ink"}`}
            title={selectionMode ? undefined : "Shift+单击复制"}
            onClick={(event) => {
              // Shift+单击=复制标题：纯 Shift（无 Ctrl/Alt/Meta）、非多选态、无文本选中才拦。
              // 拦下即 preventDefault+stopPropagation，避免打开详情；复制失败静默。
              if (selectionMode) return;
              if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
              if (window.getSelection()?.toString()) return;
              event.preventDefault();
              event.stopPropagation();
              void copyText(task.title)
                .then(() => onCopyTitle?.(task))
                .catch(() => {});
            }}
          >
            {task.title}
          </span>
          {hasMeta && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 td-text-caption text-ink-3">
              {metaChip}
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
                  {/* `#` 自己着色，不另画色点：`#` 是既有的类型标记（圆点归项目，见 ADR 0026），
                      且作为字形其面积远大于原先那个 6px 点——同一个色终于读得出。 */}
                  <span data-tag-hash style={{ color: contentTint(tag) }}>
                    #
                  </span>
                  {tag}
                </span>
              ))}
              {(task.tags ?? []).length > 3 && <span>…</span>}
            </div>
          )}
        </div>
        {/* 多选态下整条动作条关掉（产品拍板）：多选是「圈一批」的模式，单条处置在这个模式里没有位置。
            不关的后果不是"多一个按钮"：整行是勾选命中区，用户往右点必然压到「排进今天」上——任务离开
            收件箱 → 被剪枝踢出选中集（无提示）→ 落进 opacity-40 + inert 的区块 → 多选态里再也弄不回来；
            「抓到手头」更重，它顺带开/换了一个活跃会话。TaskList 已按同一理由关掉拖拽（canSort）
            与滑动（blockSwipe），这条是当时漏的第三处。 */}
        {coarsePointer === false && !selectionMode && (
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
          <InlineChildren
            parentId={task.id}
            mode={childrenMode}
            autoDraft={childTotal === 0 || undefined}
            copyDisabled={selectionMode}
            onCopyTitle={onCopyTitle}
            onEmptyDismiss={childTotal === 0 ? () => setExpanded(false) : undefined}
            dndIdPrefix={dndIdPrefix}
          />
        </div>
      )}
    </div>
  );
}
