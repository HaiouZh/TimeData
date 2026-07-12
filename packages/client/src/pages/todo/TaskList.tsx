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
  tasks: Task[];
  isOverdue?: (t: Task) => boolean;
  /**
   * 是否渲染拖柄。仅当外层 `TodoPage` 顶层 `DndContext` 已挂上才有效。
   * `containerId` 指明这一行属于哪个池容器（pool:today / pool:inbox）。
   * TaskList 会在 sortable+containerId 时自行渲染 SortableContext（不再挂 DndContext）。
   */
  sortable?: boolean;
  containerId?: "pool:today" | "pool:inbox";
  indentTargetId?: string | null;
  revealChildren?: { id: string; nonce: number } | null;
  /** 已归入某 active 目标的 task id 集合：命中的行渲染「已有去处」外圈。 */
  goalLinkedIds?: ReadonlySet<string>;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
  /** 行内额外动作插槽（如翻牌「顶一下」）。 */
  extraAction?: (task: Task) => ReactNode;
  /** 只读场景强制覆盖按 pool 推断的 children mode。 */
  childrenModeOverride?: InlineChildrenMode;
}

export function TaskList(props: TaskListProps) {
  const { pool, tasks, isOverdue, sortable, containerId } = props;
  const readOnly = pool === "completed";
  const canSort = Boolean(sortable && containerId && !readOnly);
  const isCoarsePointer = useIsCoarsePointer();

  function renderTaskRow(task: Task, dragHandle?: RowDragHandle) {
    return (
      <TaskRow
        task={task}
        pool={pool}
        overdue={pool === "today" && (isOverdue?.(task) ?? false)}
        dragHandle={dragHandle}
        coarsePointer={isCoarsePointer}
        onToggle={props.onToggle}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onToToday={readOnly ? undefined : props.onToToday}
        onToInbox={readOnly ? undefined : props.onToInbox}
        extraAction={props.extraAction}
        childrenModeOverride={props.childrenModeOverride}
        indentTargetActive={props.indentTargetId === task.id}
        revealChildren={props.revealChildren}
        inGoal={props.goalLinkedIds?.has(task.id) ?? false}
      />
    );
  }

  function renderItem(task: Task) {
    const canSwap = !readOnly && task.recurrence === null && task.ruleId === null;
    const leading =
      canSwap && (pool === "inbox" || pool === "upcoming") ? (
        <LeadingActions>
          <SwipeAction onClick={() => props.onToToday(task)}>
            <div className="flex h-full items-center bg-accent-strong px-4 text-sm font-medium text-page">排进今天</div>
          </SwipeAction>
        </LeadingActions>
      ) : undefined;
    const trailing = (
      <TrailingActions>
        {canSwap && pool === "today" && (
          <SwipeAction onClick={() => props.onToInbox(task)}>
            <div className="flex h-full items-center bg-surface-elevated px-4 text-sm font-medium text-ink">
              回收件箱
            </div>
          </SwipeAction>
        )}
        <SwipeAction destructive onClick={() => props.onDelete(task)}>
          <div className="flex h-full items-center bg-danger px-4 text-sm font-medium text-page">删除</div>
        </SwipeAction>
      </TrailingActions>
    );

    return (
      <SwipeableListItem
        key={task.id}
        className="min-w-0 max-w-full mb-1 last:mb-0"
        leadingActions={leading}
        trailingActions={trailing}
        blockSwipe={!isCoarsePointer}
        maxSwipe={0.5}
      >
        {canSort && containerId ? (
          <SortableTaskRow id={task.id} containerId={containerId}>
            {(handle) => renderTaskRow(task, handle)}
          </SortableTaskRow>
        ) : (
          renderTaskRow(task)
        )}
      </SwipeableListItem>
    );
  }

  const list = (
    <SwipeableList className="min-w-0 overflow-x-clip" type={ListType.IOS} fullSwipe={false} threshold={0.3}>
      {tasks.map((task) => renderItem(task))}
    </SwipeableList>
  );

  if (!canSort || !containerId) return list;

  return (
    <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
      {list}
    </SortableContext>
  );
}
