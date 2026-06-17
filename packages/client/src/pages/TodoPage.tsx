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
import { useState } from "react";
import type { Task, TaskSubtask } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import {
  deleteTask,
  listTasks,
  persistTaskOrder,
  scheduleTask,
  toggleTaskDone,
  unscheduleTask,
  updateSubtasks,
  type TodoBuckets,
} from "../lib/tasks.js";
import { placementForTask } from "../lib/tasks/placement.js";
import { TaskColumn } from "./todo/TaskColumn.js";
import { CollapsibleSection } from "./todo/CollapsibleSection.js";
import { TaskRow } from "./todo/TaskRow.js";
import { TodoComposer } from "./todo/TodoComposer.js";
import { TaskDetailSheet } from "./todo/TaskDetailSheet.js";
import { SortableTaskRow } from "./todo/SortableTaskRow.js";

const EMPTY: TodoBuckets = { today: [], inbox: [], upcoming: [], recurring: [], completed: [] };

export function TodoPage() {
  const buckets = useLiveQuery(() => listTasks(), [], EMPTY) ?? EMPTY;
  const [detailId, setDetailId] = useState<string | null>(null);
  const { syncAfterWrite } = useSyncContext();

  const toggle = async (t: Task) => { await toggleTaskDone(t.id); syncAfterWrite(); };
  const remove = async (t: Task) => { await deleteTask(t.id); if (detailId === t.id) setDetailId(null); syncAfterWrite(); };
  const openDetail = (t: Task) => setDetailId(t.id);
  const moveToInbox = async (t: Task) => { await unscheduleTask(t.id); syncAfterWrite(); };
  const changeSubtasks = async (t: Task, next: TaskSubtask[]) => { await updateSubtasks(t.id, next); syncAfterWrite(); };
  const moveToToday = async (t: Task) => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    await scheduleTask(t.id, `${yyyy}-${mm}-${dd}`);
    syncAfterWrite();
  };
  const isOverdue = (t: Task) => {
    const p = placementForTask(t, new Date());
    return p.pool === "today" && p.overdue;
  };

  const rowHandlers = {
    onToggle: toggle, onEdit: openDetail, onDelete: remove, onToToday: moveToToday, onToInbox: moveToInbox,
    onSubtasksChange: changeSubtasks,
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function reorderHandler(list: Task[]) {
    return async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = list.map((task) => task.id);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      await persistTaskOrder(arrayMove(ids, oldIndex, newIndex));
      syncAfterWrite();
    };
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-48 lg:max-w-5xl">
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1.6fr_1fr] lg:items-start lg:gap-x-6 lg:gap-y-4">
          {/* 今天：移动端 order-1 / 桌面左上 */}
          <div className="order-1 lg:col-start-1 lg:row-start-1">
            <TaskColumn title="今天" pool="today" tasks={buckets.today} emptyText="今天没有任务 🎉"
              hero isOverdue={isOverdue} sortable
              onReorder={async (ids) => { await persistTaskOrder(ids); syncAfterWrite(); }}
              {...rowHandlers} />
          </div>

          {/* 收件箱：移动端 order-2 / 桌面右上 */}
          <div className="order-2 lg:col-start-2 lg:row-start-1">
            <TaskColumn title="收件箱" pool="inbox" tasks={buckets.inbox} emptyText="收件箱为空" {...rowHandlers} />
          </div>

          {/* 即将到来：移动端 order-3 / 桌面左下 */}
          <div className="order-3 lg:col-start-1 lg:row-start-2">
            {buckets.upcoming.length > 0 && (
              <CollapsibleSection title="即将到来" count={buckets.upcoming.length}>
                <div className="rounded-card bg-surface p-1.5">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={reorderHandler(buckets.upcoming)}
                  >
                    <SortableContext items={buckets.upcoming.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                      {buckets.upcoming.map((task) => (
                        <SortableTaskRow key={task.id} id={task.id}>
                          {(handle) => <TaskRow task={task} pool="upcoming" dragHandle={handle} {...rowHandlers} />}
                        </SortableTaskRow>
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </CollapsibleSection>
            )}
          </div>

          {/* 重复/提醒：移动端 order-4 / 桌面右下 */}
          <div className="order-4 lg:col-start-2 lg:row-start-2">
            {buckets.recurring.length > 0 && (
              <CollapsibleSection title="重复 / 提醒" count={buckets.recurring.length}>
                <div className="rounded-card bg-surface p-1.5">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={reorderHandler(buckets.recurring)}
                  >
                    <SortableContext items={buckets.recurring.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                      {buckets.recurring.map((task) => (
                        <SortableTaskRow key={task.id} id={task.id}>
                          {(handle) => <TaskRow task={task} pool="recurring" dragHandle={handle} {...rowHandlers} />}
                        </SortableTaskRow>
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </CollapsibleSection>
            )}
          </div>
        </div>
      </div>

      <TodoComposer />

      {detailId && <TaskDetailSheet id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
