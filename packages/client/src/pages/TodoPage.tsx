import type { Task, TaskSubtask } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
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
import { TaskRow } from "./todo/TaskRow.js";
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

  // 阶段三会进一步删掉 wide/onEditSchedule 等行内入口；阶段二仅保留布局骨架，
  // 不再渲染宽屏行内 RecurrencePopover（弃了 G4 §3.5）。详细日期/重复编辑全走抽屉。
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
        renderTasks={(tasks) =>
          tasks.map((task) => (
            <TaskRow key={task.id} task={task} pool="today" {...rowHandlers} showActions={false} />
          ))
        }
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

  // 阻止未使用警告：useEffect 仅做 wide 切换时的清理钩子（保持与既有行为兼容）。
  useEffect(() => {
    /* no-op：宽屏 schedule popover 已下沉到详情抽屉，无需在此清理状态。 */
  }, [wide]);

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