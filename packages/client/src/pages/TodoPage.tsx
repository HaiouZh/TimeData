import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Task, TaskSubtask } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { groupCompletedByDay, groupInboxByDay } from "../lib/tasks/inboxGrouping.js";
import { localDateOf, placementForTask } from "../lib/tasks/placement.js";
import { filterByTags } from "../lib/tasks/turnTags.js";
import {
  getDoneCollapsed,
  getInboxCollapsed,
  getScheduledCollapsed,
  setDoneCollapsed,
  setInboxCollapsed,
  setScheduledCollapsed,
} from "../lib/tasks/workbenchPrefs.js";
import {
  deleteTask,
  listTasks,
  moveTaskToParent,
  persistTaskOrder,
  promoteToRoot,
  scheduleTask,
  setTaskTags,
  setTaskTurn,
  type TodoBuckets,
  toggleTaskDone,
  unscheduleTask,
  updateSubtasks,
} from "../lib/tasks.js";
import { useIsWideScreen } from "../lib/useIsWideScreen.js";
import { AttentionQueue } from "./todo/AttentionQueue.js";
import { CollapsibleSection } from "./todo/CollapsibleSection.js";
import { DayGroupedList } from "./todo/DayGroupedList.js";
import { ResizableSplit } from "./todo/ResizableSplit.js";
import { TagFilterBar } from "./todo/TagFilterBar.js";
import { TaskColumn } from "./todo/TaskColumn.js";
import { TaskDetailSheet } from "./todo/TaskDetailSheet.js";
import { TaskList } from "./todo/TaskList.js";
import { TodoComposer } from "./todo/TodoComposer.js";
import { resolveTodoDragOperation } from "./todo/todoDnd.js";

const EMPTY: TodoBuckets = { today: [], inbox: [], scheduled: [], recurring: [], completed: [] };

export function TodoPage() {
  const buckets = useLiveQuery(() => listTasks(), [], EMPTY) ?? EMPTY;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { syncAfterWrite } = useSyncContext();
  const wide = useIsWideScreen();

  const toggle = async (t: Task) => {
    await toggleTaskDone(t.id);
    syncAfterWrite();
  };
  const remove = async (t: Task) => {
    await deleteTask(t.id);
    if (detailId === t.id) setDetailId(null);
    syncAfterWrite();
  };
  const openDetail = (t: Task) => setDetailId(t.id);
  const moveToInbox = async (t: Task) => {
    await unscheduleTask(t.id);
    syncAfterWrite();
  };
  const changeSubtasks = async (t: Task, next: TaskSubtask[]) => {
    await updateSubtasks(t.id, next);
    syncAfterWrite();
  };
  const moveToToday = async (t: Task) => {
    await scheduleTask(t.id, localDateOf(new Date()));
    syncAfterWrite();
  };
  const changeTurn = async (t: Task, turn: Task["turn"]) => {
    await setTaskTurn(t.id, turn);
    syncAfterWrite();
  };
  const changeTags = async (t: Task, tags: string[]) => {
    await setTaskTags(t.id, tags);
    syncAfterWrite();
  };
  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
  const clearTags = () => setSelectedTags([]);
  const isOverdue = (t: Task) => {
    const p = placementForTask(t, new Date());
    return p.pool === "today" && p.overdue;
  };

  const rowHandlers = {
    onToggle: toggle,
    onEdit: openDetail,
    onDelete: remove,
    onToToday: moveToToday,
    onToInbox: moveToInbox,
    onSubtasksChange: changeSubtasks,
    onTurnChange: changeTurn,
    onTagsChange: changeTags,
  };

  const allTasks: Task[] = Array.from(
    new Map(
      [...buckets.today, ...buckets.inbox, ...buckets.scheduled, ...buckets.recurring].map((t) => [t.id, t]),
    ).values(),
  );
  const f = (list: Task[]) => filterByTags(list, selectedTags);

  // —— 顶层 DnD：单一 DndContext 包住整页，可拖区只有 today/inbox ——
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent): void {
    void event;
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeData = active.data.current as { containerId?: string } | undefined;
    const overData = over.data.current as { containerId?: string } | undefined;
    const activeContainerId = activeData?.containerId ?? "";
    const overContainerId = overData?.containerId ?? "";

    let activeParentId: string | null = null;
    const activeTask = [...buckets.today, ...buckets.inbox].find((t) => t.id === activeId);
    if (activeTask) {
      activeParentId = activeTask.parentId ?? null;
    } else {
      const found = allTasks.find((t) => t.id === activeId);
      activeParentId = found?.parentId ?? null;
    }

    const op = resolveTodoDragOperation({
      activeContainerId,
      targetContainerId: overContainerId || activeContainerId,
      activeParentId,
    });

    if (!op) return;

    try {
      switch (op.kind) {
        case "reorder": {
          const containerTasks =
            op.containerId === "pool:today" ? f(buckets.today) : op.containerId === "pool:inbox" ? f(buckets.inbox) : [];
          if (containerTasks.length === 0) return;
          const ids = containerTasks.map((t) => t.id);
          const oldIndex = ids.indexOf(activeId);
          const newIndex = ids.indexOf(overId);
          if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
          const ordered = arrayMove(ids, oldIndex, newIndex);
          await persistTaskOrder(ordered);
          syncAfterWrite();
          break;
        }
        case "move-to-parent": {
          await moveTaskToParent(activeId, op.parentId, 0);
          syncAfterWrite();
          break;
        }
        case "promote-to-root": {
          const targetTasks = op.pool === "today" ? f(buckets.today) : f(buckets.inbox);
          const sortOrder = targetTasks.length > 0 ? Math.max(...targetTasks.map((t) => t.sortOrder)) + 1 : 0;
          await promoteToRoot(activeId, op.pool, sortOrder);
          syncAfterWrite();
          break;
        }
        case "schedule-root": {
          if (op.pool === "today") {
            await scheduleTask(activeId, localDateOf(new Date()));
          } else {
            await unscheduleTask(activeId);
          }
          syncAfterWrite();
          break;
        }
      }
    } catch (err) {
      void err;
    }
  }

  const todayBlock = (
    <TaskColumn
      title="今天"
      pool="today"
      tasks={f(buckets.today)}
      emptyText="今天没有任务 🎉"
      hero
      isOverdue={isOverdue}
      sortable
      containerId="pool:today"
      {...rowHandlers}
    />
  );

  const completedFiltered = f(buckets.completed);
  const completedBlock = completedFiltered.length > 0 && (
    <CollapsibleSection
      title="已完成"
      count={completedFiltered.length}
      defaultOpen={!getDoneCollapsed()}
      onToggle={(open) => setDoneCollapsed(!open)}
    >
      <DayGroupedList
        segments={groupCompletedByDay(completedFiltered)}
        renderTasks={(tasks) => <TaskList pool="completed" tasks={tasks} {...rowHandlers} />}
      />
    </CollapsibleSection>
  );

  const inboxFiltered = f(buckets.inbox);
  const inboxBlock = (
    <section data-section="inbox">
      <CollapsibleSection
        title="收件箱"
        count={inboxFiltered.length}
        defaultOpen={!getInboxCollapsed()}
        onToggle={(open) => setInboxCollapsed(!open)}
      >
        {inboxFiltered.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">收件箱为空</p>
        ) : (
          <DayGroupedList
            segments={groupInboxByDay(inboxFiltered)}
            renderTasks={(tasks) => (
              <TaskList pool="inbox" tasks={tasks} sortable containerId="pool:inbox" {...rowHandlers} />
            )}
          />
        )}
      </CollapsibleSection>
    </section>
  );

  const scheduledFiltered = f(buckets.scheduled);
  const scheduledBlock = (
    <CollapsibleSection
      title="已排期"
      count={scheduledFiltered.length}
      defaultOpen={!getScheduledCollapsed()}
      onToggle={(open) => setScheduledCollapsed(!open)}
    >
      {scheduledFiltered.length === 0 ? (
        <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">没有已排期任务</p>
      ) : (
        <div className="rounded-card bg-surface p-1.5">
          <TaskList pool="upcoming" tasks={scheduledFiltered} {...rowHandlers} />
        </div>
      )}
    </CollapsibleSection>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      <div className="min-h-full bg-page text-ink">
        <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-48 lg:max-w-none">
          <AttentionQueue tasks={allTasks} rowHandlers={rowHandlers} onTurnChange={changeTurn} />
          <TagFilterBar tasks={allTasks} selected={selectedTags} onToggle={toggleTag} onClear={clearTags} />
          {wide ? (
            <ResizableSplit
              className="items-start gap-y-4"
              left={
                <>
                  {todayBlock}
                  {completedBlock}
                </>
              }
              right={
                <>
                  {scheduledBlock}
                  {inboxBlock}
                </>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {todayBlock}
              {completedBlock}
              {scheduledBlock}
              {inboxBlock}
            </div>
          )}
        </div>

        <TodoComposer />

        {detailId && (
          <TaskDetailSheet
            id={detailId}
            onClose={() => setDetailId(null)}
            onTurnChange={changeTurn}
            onTagsChange={changeTags}
          />
        )}
      </div>
    </DndContext>
  );
}