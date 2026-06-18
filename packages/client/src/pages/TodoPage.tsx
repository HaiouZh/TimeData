import type { Task, TaskSubtask } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { groupCompletedByDay, groupInboxByDay } from "../lib/tasks/inboxGrouping.js";
import { placementForTask } from "../lib/tasks/placement.js";
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
  persistTaskOrder,
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

  // 行级回调统一来源：toggle/edit/delete + 换池 + 子任务 + 回合 + 标签。
  // 删除走 TaskList 的 swipe destructive；TaskRow 自身不再渲染 ✕。
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

  // listTasks 故意把到期重复同时放进 today 和 recurring，allTasks 须按 id 去重。
  // completed 故意不并入 AttentionQueue / TagFilterBar 频次源——已完成不再贡献注意力。
  const allTasks: Task[] = Array.from(
    new Map(
      [...buckets.today, ...buckets.inbox, ...buckets.scheduled, ...buckets.recurring].map((t) => [t.id, t]),
    ).values(),
  );
  const f = (list: Task[]) => filterByTags(list, selectedTags);

  const todayBlock = (
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
            renderTasks={(tasks) => <TaskList pool="inbox" tasks={tasks} {...rowHandlers} />}
          />
        )}
      </CollapsibleSection>
    </section>
  );

  // 已排期 = 一次性未来排期 + 未到期重复，扁平排序。
  // pool="upcoming" 让 TaskList 给一次性任务出「排进今天 + 删除」滑动；
  // 重复任务靠 canSwap=task.recurrence===null 自动只剩删除滑动，不需要新 pool 类型。
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
  );
}