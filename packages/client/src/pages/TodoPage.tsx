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
import type { Task, TaskSubtask } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { groupInboxByDay } from "../lib/tasks/inboxGrouping.js";
import { normalizeScheduledDate, placementForTask } from "../lib/tasks/placement.js";
import { recurrenceToCustomInput } from "../lib/tasks/recurrencePresets.js";
import { filterByTags } from "../lib/tasks/turnTags.js";
import {
  getDoneCollapsed,
  getInboxCollapsed,
  setDoneCollapsed,
  setInboxCollapsed,
} from "../lib/tasks/workbenchPrefs.js";
import {
  applyRecurrenceChoice,
  deleteTask,
  listTasks,
  persistTaskOrder,
  scheduleTask,
  setTaskTags,
  setTaskTurn,
  type TodoBuckets,
  toggleTaskDone,
  unscheduleTask,
  updateSubtasks,
  updateTask,
} from "../lib/tasks.js";
import { getDateString } from "../lib/time.js";
import { useIsWideScreen } from "../lib/useIsWideScreen.js";
import { AttentionQueue } from "./todo/AttentionQueue.js";
import { CollapsibleSection } from "./todo/CollapsibleSection.js";
import { CustomRecurrencePage } from "./todo/CustomRecurrencePage.js";
import { RecurrencePopover } from "./todo/RecurrencePopover.js";
import { ResizableSplit } from "./todo/ResizableSplit.js";
import { SortableTaskRow } from "./todo/SortableTaskRow.js";
import { TagFilterBar } from "./todo/TagFilterBar.js";
import { TaskColumn } from "./todo/TaskColumn.js";
import { TaskDetailSheet } from "./todo/TaskDetailSheet.js";
import { TaskList } from "./todo/TaskList.js";
import { TaskRow } from "./todo/TaskRow.js";
import { TodoComposer } from "./todo/TodoComposer.js";

const EMPTY: TodoBuckets = { today: [], inbox: [], upcoming: [], recurring: [], completed: [], todayDone: [] };
const DEFAULT_RECURRENCE = { freq: "daily" as const, interval: 1, basis: "due" as const };

export function TodoPage() {
  const buckets = useLiveQuery(() => listTasks(), [], EMPTY) ?? EMPTY;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<{ task: Task; anchorEl: HTMLElement } | null>(null);
  const [scheduleOverlay, setScheduleOverlay] = useState<"popover" | "custom">("popover");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { syncAfterWrite } = useSyncContext();
  const wide = useIsWideScreen();

  useEffect(() => {
    if (!wide) setSchedule(null);
  }, [wide]);

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
  const openSchedule = (task: Task, anchorEl: HTMLElement) => {
    setSchedule({ task, anchorEl });
    setScheduleOverlay("popover");
  };
  const moveToInbox = async (t: Task) => {
    await unscheduleTask(t.id);
    syncAfterWrite();
  };
  const changeSubtasks = async (t: Task, next: TaskSubtask[]) => {
    await updateSubtasks(t.id, next);
    syncAfterWrite();
  };
  const moveToToday = async (t: Task) => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    await scheduleTask(t.id, `${yyyy}-${mm}-${dd}`);
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
  const wideRowProps = wide ? { wide: true as const, onEditSchedule: openSchedule } : {};
  const todayRowProps = wide ? { wide: true as const, onEditSchedule: openSchedule, showActions: true as const } : {};
  const doneRowProps = wide
    ? { wide: true as const, onEditSchedule: openSchedule, showActions: false as const }
    : { showActions: false as const };

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

  // AttentionQueue + TagFilterBar 用未筛选的全量；下方各池用 filterByTags 过滤后再渲染。
  // 注意去重：listTasks 把到期重复任务同时放进 buckets.recurring 与 buckets.today（行为故意保留，
  // 让到期重复在「今天」可见），但拼成 allTasks 时必须按 id 去重，否则 AttentionQueue 渲染重复 key、
  // TagFilterBar 频次翻倍。
  const allTasks: Task[] = Array.from(
    new Map(
      [...buckets.today, ...buckets.inbox, ...buckets.upcoming, ...buckets.recurring, ...buckets.todayDone].map((t) => [
        t.id,
        t,
      ]),
    ).values(),
  );
  const f = (list: Task[]) => filterByTags(list, selectedTags);

  const doneTail = buckets.todayDone.length > 0 && (
    <div className="mt-2">
      <CollapsibleSection
        title="已完成"
        count={buckets.todayDone.length}
        defaultOpen={!getDoneCollapsed()}
        onToggle={(open) => setDoneCollapsed(!open)}
      >
        <div className="rounded-card bg-surface p-1.5">
          {f(buckets.todayDone).map((task) => (
            <TaskRow key={task.id} task={task} pool="today" {...rowHandlers} {...doneRowProps} />
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );

  const todayBlock = (
    <>
      <TaskColumn
        title="今天"
        pool="today"
        tasks={f(buckets.today)}
        emptyText="今天没有任务 🎉"
        hero
        isOverdue={isOverdue}
        sortable
        onReorder={async (ids) => {
          await persistTaskOrder(ids);
          syncAfterWrite();
        }}
        {...rowHandlers}
        {...todayRowProps}
      />
      {doneTail}
    </>
  );

  const inboxCollapsible = (
    <CollapsibleSection
      title="收件箱"
      count={buckets.inbox.length}
      defaultOpen={!getInboxCollapsed()}
      onToggle={(open) => setInboxCollapsed(!open)}
    >
      {buckets.inbox.length === 0 ? (
        <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">收件箱为空</p>
      ) : (
        <div className="rounded-card bg-surface p-1.5">
          <TaskList pool="inbox" tasks={f(buckets.inbox)} {...rowHandlers} />
        </div>
      )}
    </CollapsibleSection>
  );

  const wideTodayBlock = (
    <div data-col="today">
      <TaskColumn
        title="今天"
        pool="today"
        tasks={f(buckets.today)}
        emptyText="今天没有任务 🎉"
        hero
        isOverdue={isOverdue}
        sortable
        onReorder={async (ids) => {
          await persistTaskOrder(ids);
          syncAfterWrite();
        }}
        {...rowHandlers}
        {...wideRowProps}
      />
      {doneTail}
    </div>
  );

  const wideInboxBlock = (
    <section data-section="inbox" data-col="inbox">
      <CollapsibleSection
        title="收件箱"
        count={buckets.inbox.length}
        defaultOpen={!getInboxCollapsed()}
        onToggle={(open) => setInboxCollapsed(!open)}
      >
        {buckets.inbox.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">收件箱为空</p>
        ) : (
          groupInboxByDay(buckets.inbox).map((segment) => {
            const filtered = f(segment.tasks);
            if (filtered.length === 0) return null;
            return (
              <div key={segment.key} className="mb-3">
                <p className="px-2 pb-1 text-xs text-ink-3">{segment.label}</p>
                <div className="rounded-card bg-surface p-1.5">
                  <TaskList pool="inbox" tasks={filtered} {...rowHandlers} {...wideRowProps} />
                </div>
              </div>
            );
          })
        )}
      </CollapsibleSection>
    </section>
  );

  const upcomingFiltered = f(buckets.upcoming);
  const upcomingBlock = (
    <div>
      {upcomingFiltered.length > 0 && (
        <CollapsibleSection title="即将到来" count={upcomingFiltered.length}>
          <div className="rounded-card bg-surface p-1.5">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={reorderHandler(upcomingFiltered)}
            >
              <SortableContext items={upcomingFiltered.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                {upcomingFiltered.map((task) => (
                  <SortableTaskRow key={task.id} id={task.id}>
                    {(handle) => (
                      <TaskRow task={task} pool="upcoming" dragHandle={handle} {...rowHandlers} {...wideRowProps} />
                    )}
                  </SortableTaskRow>
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );

  const recurringFiltered = f(buckets.recurring);
  const recurringBlock = (
    <div>
      {recurringFiltered.length > 0 && (
        <CollapsibleSection title="重复 / 提醒" count={recurringFiltered.length}>
          <div className="rounded-card bg-surface p-1.5">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={reorderHandler(recurringFiltered)}
            >
              <SortableContext items={recurringFiltered.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                {recurringFiltered.map((task) => (
                  <SortableTaskRow key={task.id} id={task.id}>
                    {(handle) => (
                      <TaskRow task={task} pool="recurring" dragHandle={handle} {...rowHandlers} {...wideRowProps} />
                    )}
                  </SortableTaskRow>
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-48 lg:max-w-none">
        <AttentionQueue tasks={allTasks} rowHandlers={rowHandlers} onTurnChange={changeTurn} />
        <TagFilterBar tasks={allTasks} selected={selectedTags} onToggle={toggleTag} onClear={clearTags} />
        {wide ? (
          <ResizableSplit
            className="items-start gap-y-4"
            left={
              <>
                {wideTodayBlock}
                {upcomingBlock}
              </>
            }
            right={
              <>
                {wideInboxBlock}
                {recurringBlock}
              </>
            }
          />
        ) : (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1.6fr_1fr] lg:items-start lg:gap-x-6 lg:gap-y-4">
            <div className="order-1 lg:col-start-1 lg:row-start-1">{todayBlock}</div>
            <section data-section="inbox" className="order-2 lg:col-start-2 lg:row-start-1">
              {inboxCollapsible}
            </section>
            <div className="order-3 lg:col-start-1 lg:row-start-2">{upcomingBlock}</div>
            <div className="order-4 lg:col-start-2 lg:row-start-2">{recurringBlock}</div>
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
      {wide && schedule && scheduleOverlay === "popover" && (
        <RecurrencePopover
          anchorEl={schedule.anchorEl}
          current={schedule.task.recurrence}
          scheduledAt={schedule.task.scheduledAt ?? null}
          anchor={schedule.task.startAt ? getDateString(new Date(schedule.task.startAt)) : getDateString(new Date())}
          onChoose={async (choice) => {
            const id = schedule.task.id;
            setSchedule(null);
            await applyRecurrenceChoice(id, choice);
            syncAfterWrite();
          }}
          onCustom={() => setScheduleOverlay("custom")}
          onClose={() => setSchedule(null)}
        />
      )}
      {wide && schedule && scheduleOverlay === "custom" && (
        <CustomRecurrencePage
          initial={recurrenceToCustomInput(
            schedule.task.recurrence ?? DEFAULT_RECURRENCE,
            schedule.task.startAt,
            schedule.task.startAt ? getDateString(new Date(schedule.task.startAt)) : getDateString(new Date()),
          )}
          onBack={() => setScheduleOverlay("popover")}
          onComplete={async (recurrence, startDate) => {
            const id = schedule.task.id;
            setSchedule(null);
            await updateTask(id, { recurrence, startAt: normalizeScheduledDate(startDate) });
            syncAfterWrite();
          }}
        />
      )}
    </div>
  );
}
