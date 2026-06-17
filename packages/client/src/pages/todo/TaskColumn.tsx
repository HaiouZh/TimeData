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
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  LeadingActions,
  SwipeableList,
  SwipeableListItem,
  SwipeAction,
  TrailingActions,
  Type as ListType,
} from "@meauxt/react-swipeable-list";
import "@meauxt/react-swipeable-list/dist/styles.css";
import type { Task, TaskSubtask } from "@timedata/shared";
import { TaskRow, type RowDragHandle, type TaskPool } from "./TaskRow.js";
import { SortableTaskRow } from "./SortableTaskRow.js";

export interface TaskColumnProps {
  title: string;
  pool: Extract<TaskPool, "today" | "inbox" | "upcoming">;
  tasks: Task[];
  emptyText: string;
  hero?: boolean;
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

export function TaskColumn(props: TaskColumnProps) {
  const { title, pool, tasks, emptyText, hero, isOverdue, sortable } = props;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
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
        onToToday={props.onToToday}
        onToInbox={props.onToInbox}
        onSubtasksChange={props.onSubtasksChange}
      />
    );
  }

  function renderItem(task: Task) {
    const canSwap = task.recurrence === null;
    const leading =
      canSwap && (pool === "inbox" || pool === "upcoming") ? (
        <LeadingActions>
          <SwipeAction onClick={() => props.onToToday(task)}>
            <div className="flex h-full items-center bg-accent-strong px-4 text-sm font-medium text-page">
              排进今天
            </div>
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

  return (
    <section data-section={pool}>
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className={`font-medium text-ink ${hero ? "text-base" : "text-sm"}`}>{title}</h2>
        <span className="text-xs text-ink-3">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">{emptyText}</p>
      ) : (
        <div className="rounded-card bg-surface p-1.5">
          {sortable ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                {list}
              </SortableContext>
            </DndContext>
          ) : (
            list
          )}
        </div>
      )}
    </section>
  );
}
