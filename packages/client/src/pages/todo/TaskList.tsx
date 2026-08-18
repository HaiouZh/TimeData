import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  LeadingActions,
  Type as ListType,
  SwipeAction,
  SwipeableList,
  SwipeableListItem,
  TrailingActions,
} from "@meauxt/react-swipeable-list";
import "@meauxt/react-swipeable-list/dist/styles.css";
import type { Task } from "@timedata/shared";
import type { ReactNode } from "react";
import { useIsCoarsePointer } from "../../lib/useIsCoarsePointer.js";
import { SortableTaskRow } from "./SortableTaskRow.js";
import { type RowDragHandle, type TaskPool, TaskRow } from "./TaskRow.js";
import type { InlineChildrenMode } from "./InlineChildren.js";

export interface TaskListProps {
  pool: Extract<TaskPool, "today" | "inbox" | "upcoming" | "completed">;
  /**
   * 混池列表（项目区）按行覆盖 pool。列表级 `pool` 在那里只表达「这块怎么铺」，
   * 组内成员各自处在不同的时间轴位置，行动作跟着列表级 pool 走就会全挂同一个箭头——
   * 已排今天的行照样显示「排进今天」。返回值同时喂 TaskRow 与滑动动作，两条通道一个口径。
   */
  rowPool?: (task: Task) => Extract<TaskPool, "today" | "inbox">;
  /** 已在手头的行：关掉「抓到手头」（悬停按钮 + 滑动），它已经在那儿了。 */
  atHandIds?: ReadonlySet<string>;
  tasks: Task[];
  isOverdue?: (t: Task) => boolean;
  /**
   * 是否渲染拖柄。仅当外层 `TodoPage` 顶层 `DndContext` 已挂上才有效。
   * `containerId` 指明这一行属于哪个池容器（pool:today / pool:inbox）。
   * TaskList 会在 sortable+containerId 时自行渲染 SortableContext（不再挂 DndContext）。
   */
  sortable?: boolean;
  containerId?: "pool:today" | "pool:inbox" | `project:${string}`;
  /** 行与子任务行的 dnd id 前缀（项目区用，见 SortableTaskRow.dndId）。 */
  dndIdPrefix?: string;
  indentTargetId?: string | null;
  revealChildren?: { id: string; nonce: number } | null;
  /** 已归入某 active 目标的 task id 集合：命中的行渲染「已有去处」外圈。 */
  goalLinkedIds?: ReadonlySet<string>;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
  onToHand?: (t: Task) => void;
  /** 标题 Shift+单击复制成功后的上抛回调（透传给 TaskRow）。 */
  onCopyTitle?: (t: Task) => void;
  /** 行内额外动作插槽（如翻牌「顶一下」）。 */
  extraAction?: (task: Task) => ReactNode;
  /** meta 胶囊带插槽（项目区状态点 / 项目名 chip）；返回 null 即该行不加。 */
  metaChip?: (task: Task) => ReactNode;
  /** 「被挡着的」那一段的第一条成员 id；该行画分界上边框。无被挡成员时传 null 或不传。 */
  blockedBoundaryId?: string | null;
  /** 只读场景强制覆盖按 pool 推断的 children mode。 */
  childrenModeOverride?: InlineChildrenMode;
  /** 页面级多选态：行点击变勾选，拖拽与滑动一并禁用。 */
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (task: Task) => void;
}

export function TaskList(props: TaskListProps) {
  const { pool, tasks, isOverdue, sortable, containerId } = props;
  const readOnly = pool === "completed";
  const canSort = Boolean(sortable && containerId && !readOnly && !props.selectionMode);
  const isCoarsePointer = useIsCoarsePointer();
  // 只读列表不给行覆盖：completed 的行动作本来就全关，逐行改 pool 只会把「回收件箱」放回来。
  const poolOf = (task: Task): TaskPool => (readOnly ? pool : (props.rowPool?.(task) ?? pool));

  function renderTaskRow(task: Task, dragHandle?: RowDragHandle) {
    return (
      <TaskRow
        task={task}
        pool={poolOf(task)}
        overdue={pool === "today" && (isOverdue?.(task) ?? false)}
        dragHandle={dragHandle}
        coarsePointer={isCoarsePointer}
        onToggle={props.onToggle}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onToToday={readOnly ? undefined : props.onToToday}
        onToInbox={readOnly ? undefined : props.onToInbox}
        onToHand={props.onToHand}
        atHand={props.atHandIds?.has(task.id) ?? false}
        onCopyTitle={props.onCopyTitle}
        extraAction={props.extraAction}
        childrenModeOverride={props.selectionMode ? "static" : props.childrenModeOverride}
        indentTargetActive={props.indentTargetId === task.id}
        revealChildren={props.revealChildren}
        inGoal={props.goalLinkedIds?.has(task.id) ?? false}
        metaChip={props.metaChip?.(task)}
        blockedBoundary={props.blockedBoundaryId != null && props.blockedBoundaryId === task.id}
        selectionMode={props.selectionMode}
        selected={props.selectedIds?.has(task.id) ?? false}
        onToggleSelect={props.onToggleSelect}
        dndIdPrefix={props.dndIdPrefix}
      />
    );
  }

  function renderItem(task: Task) {
    const canSwap = !readOnly && task.recurrence === null && task.ruleId === null;
    // 与悬停按钮同一个 poolOf：滑动与悬停是同一批动作的两种指针形态，口径分叉就是「桌面对了、手机还错」。
    const rowPool = poolOf(task);
    const leading =
      canSwap && (rowPool === "inbox" || rowPool === "upcoming") ? (
        <LeadingActions>
          <SwipeAction onClick={() => props.onToToday(task)}>
            {/* 行卡片化后动作色块跟随行圆角，避免直角块贴圆角卡透出底色缺口 */}
            <div className="flex h-full items-center rounded-row bg-accent-strong px-4 td-text-label font-medium text-page">
              排进今天
            </div>
          </SwipeAction>
        </LeadingActions>
      ) : undefined;
    const trailing = (
      <TrailingActions>
        {canSwap && rowPool === "today" && (
          <SwipeAction onClick={() => props.onToInbox(task)}>
            <div className="flex h-full items-center rounded-row bg-surface-elevated px-4 td-text-label font-medium text-ink">
              回收件箱
            </div>
          </SwipeAction>
        )}
        {props.onToHand && task.recurrence === null && pool !== "completed" && !props.atHandIds?.has(task.id) && (
          <SwipeAction onClick={() => props.onToHand?.(task)}>
            <div className="flex h-full items-center rounded-row bg-surface-elevated px-4 td-text-label font-medium text-ink">
              抓到手头
            </div>
          </SwipeAction>
        )}
        <SwipeAction destructive onClick={() => props.onDelete(task)}>
          <div className="flex h-full items-center rounded-row bg-danger px-4 td-text-label font-medium text-page">删除</div>
        </SwipeAction>
      </TrailingActions>
    );

    return (
      <SwipeableListItem
        key={task.id}
        className="min-w-0 max-w-full"
        leadingActions={leading}
        trailingActions={trailing}
        blockSwipe={!isCoarsePointer || Boolean(props.selectionMode)}
        maxSwipe={0.5}
      >
        {canSort && containerId ? (
          // 缩进态（indentTargetId 非空）下冻结全行避让，只留高亮环——理由见 SortableTaskRow 的
          // freezeShift 注释。indentTargetId 本身已经是"是否处于缩进态"的现成信号，不必另开一个。
          <SortableTaskRow
            id={task.id}
            dndId={props.dndIdPrefix ? `${props.dndIdPrefix}${task.id}` : undefined}
            containerId={containerId}
            freezeShift={props.indentTargetId != null}
          >
            {(handle) => renderTaskRow(task, handle)}
          </SortableTaskRow>
        ) : (
          renderTaskRow(task)
        )}
      </SwipeableListItem>
    );
  }

  const list = (
    // 行缝声明在容器（space-y）而非逐项 margin：不依赖库把 className 挂到直接子元素
    // 尾部无兄弟节点的 DOM 假设，也省掉 last: 补丁。
    <SwipeableList className="min-w-0 space-y-1 overflow-x-clip" type={ListType.IOS} fullSwipe={false} threshold={0.3}>
      {tasks.map((task) => renderItem(task))}
    </SwipeableList>
  );

  if (!canSort || !containerId) return list;

  return (
    <SortableContext
      items={tasks.map((t) => (props.dndIdPrefix ? `${props.dndIdPrefix}${t.id}` : t.id))}
      strategy={verticalListSortingStrategy}
    >
      {list}
    </SortableContext>
  );
}
