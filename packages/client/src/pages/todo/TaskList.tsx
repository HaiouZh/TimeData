import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  LeadingActions,
  Type as ListType,
  SwipeAction,
  SwipeableList,
  SwipeableListItem,
  TrailingActions,
} from "@meauxt/react-swipeable-list";
import "@meauxt/react-swipeable-list/dist/styles.css";
import type { Task, TaskSubtask } from "@timedata/shared";
import { useState } from "react";
import { SortableTaskRow } from "./SortableTaskRow.js";
import { type RowDragHandle, type TaskPool, TaskRow } from "./TaskRow.js";

export interface TaskListProps {
  pool: Extract<TaskPool, "today" | "inbox" | "upcoming">;
  tasks: Task[];
  isOverdue?: (t: Task) => boolean;
  sortable?: boolean;
  onReorder?: (orderedIds: string[]) => void;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
  onSubtasksChange: (task: Task, next: TaskSubtask[]) => void;
}

export function TaskList(props: TaskListProps) {
  const { pool, tasks, isOverdue, sortable } = props;
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = tasks.map((task) => task.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    props.onReorder?.(arrayMove(ids, oldIndex, newIndex));
  }

  function renderTaskRow(task: Task, dragHandle?: RowDragHandle) {
    return (
      <TaskRow
        task={task}
        pool={pool}
        overdue={pool === "today" && (isOverdue?.(task) ?? false)}
        dragHandle={dragHandle}
        onToggle={props.onToggle}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onSubtasksChange={props.onSubtasksChange}
      />
    );
  }

  function renderItem(task: Task) {
    // 重复任务仅得删除滑动；一次性任务在收件箱/已排期得「排进今天」、在今天得「回收件箱」。
    const canSwap = task.recurrence === null;
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
      <SwipeableListItem key={task.id} leadingActions={leading} trailingActions={trailing}>
        {sortable ? (
          <SortableTaskRow id={task.id}>{(handle) => renderTaskRow(task, handle)}</SortableTaskRow>
        ) : (
          renderTaskRow(task)
        )}
      </SwipeableListItem>
    );
  }

  const list = (
    <SwipeableList type={ListType.IOS} fullSwipe={false}>
      {tasks.map((task) => renderItem(task))}
    </SwipeableList>
  );

  if (!sortable) return list;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className={dragging ? "todo-dnd-dragging" : undefined}>{list}</div>
      </SortableContext>
    </DndContext>
  );
}