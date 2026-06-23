import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { db } from "../db/index.js";
import { groupCompletedByDay, groupInboxByDay } from "../lib/tasks/inboxGrouping.js";
import { localDateString, placementForTask } from "../lib/tasks/placement.js";
import { allTags, filterTasks } from "../lib/tasks/turnTags.js";
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
  reorderChildren,
  scheduleTask,
  setTaskTags,
  type TodoBuckets,
  toggleTaskDone,
  unscheduleTask,
} from "../lib/tasks.js";
import { useIsWideScreen } from "../lib/useIsWideScreen.js";
import { CollapsibleSection } from "./todo/CollapsibleSection.js";
import { DayGroupedList } from "./todo/DayGroupedList.js";
import { ResizableSplit } from "./todo/ResizableSplit.js";
import { TaskColumn } from "./todo/TaskColumn.js";
import { TaskDetailSheet } from "./todo/TaskDetailSheet.js";
import { TaskList } from "./todo/TaskList.js";
import { TodoComposer } from "./todo/TodoComposer.js";
import {
  clampTodoIndentPreview,
  hoveredRootIdFromOver,
  parseTodoContainerId,
  resolveIndentLevel,
  resolveTodoDragWithIndent,
  type TodoIndentLevel,
  type TodoPool,
} from "./todo/todoDnd.js";

const EMPTY: TodoBuckets = { today: [], inbox: [], scheduled: [], recurring: [], completed: [] };
const TODO_COMPOSER_CONTENT_GAP_PX = 24;

export function TodoPage() {
  const buckets = useLiveQuery(() => listTasks(), [], EMPTY) ?? EMPTY;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"and" | "or">("and");
  const [filterOpen, setFilterOpen] = useState(false);
  const [notMode, setNotMode] = useState(false);
  const [composerText, setComposerText] = useState("");
  // 拖拽期间挂 todo-dnd-dragging：临时解除 .swipeable-list-item 的 overflow:hidden，
  // 否则 dnd-kit 的 translateY 会被裁掉、被拖/让位的行隐身（index.css 有对应规则）。
  const [dragging, setDragging] = useState(false);
  const indentRef = useRef<TodoIndentLevel>("root");
  // 被拖项自身的缩进基线：拖根任务=root（向右变子），拖子任务=child（向左升级为根）。
  const indentBaseRef = useRef<TodoIndentLevel>("root");
  const [indentTargetId, setIndentTargetId] = useState<string | null>(null);
  const [revealChildren, setRevealChildren] = useState<{ id: string; nonce: number } | null>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const [composerHeightPx, setComposerHeightPx] = useState(0);
  const { syncAfterWrite } = useSyncContext();
  const { hidden: navHidden } = useBottomNav();
  const wide = useIsWideScreen();
  const rootIdsWithChildren =
    useLiveQuery(async () => {
      const children = await db.tasks.filter((task) => task.parentId !== null).toArray();
      return new Set(children.map((child) => child.parentId).filter((id): id is string => Boolean(id)));
    }, []) ?? new Set<string>();
  const navOffsetPx = navHidden ? 0 : BOTTOM_NAV_HEIGHT_PX;
  const composerAvoidancePx = Math.ceil(composerHeightPx + navOffsetPx);
  const contentBottomPaddingPx = Math.max(192, composerAvoidancePx + TODO_COMPOSER_CONTENT_GAP_PX);

  const measureComposer = useCallback(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const height = composer.getBoundingClientRect().height;
    if (height <= 0) return;
    const nextHeight = Math.ceil(height);
    setComposerHeightPx((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
  }, []);

  useLayoutEffect(() => {
    measureComposer();
  });

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measureComposer);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [measureComposer]);

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
  const moveToToday = async (t: Task) => {
    await scheduleTask(t.id, localDateString(new Date()));
    syncAfterWrite();
  };
  const changeTags = async (t: Task, tags: string[]) => {
    await setTaskTags(t.id, tags);
    syncAfterWrite();
  };
  const toggleTag = (tag: string) => {
    if (notMode) {
      setIncludeTags((prev) => prev.filter((x) => x !== tag));
      setExcludeTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
    } else {
      setExcludeTags((prev) => prev.filter((x) => x !== tag));
      setIncludeTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
    }
  };
  const toggleMode = () => setTagMode((mode) => (mode === "and" ? "or" : "and"));
  const toggleNotMode = () => setNotMode((value) => !value);
  const clearTags = () => {
    setIncludeTags([]);
    setExcludeTags([]);
    setTagMode("and");
  };
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
    onAfterChildWrite: syncAfterWrite,
    onTagsChange: changeTags,
  };

  const allTasks: Task[] = Array.from(
    new Map(
      [...buckets.today, ...buckets.inbox, ...buckets.scheduled, ...buckets.recurring].map((t) => [t.id, t]),
    ).values(),
  );
  const tagOptions = allTags(allTasks);
  const f = (list: Task[]) => filterTasks(list, { searchQuery: composerText, includeTags, excludeTags, tagMode });

  // —— 顶层 DnD：单一 DndContext 包住整页，可拖区只有 today/inbox ——
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent): void {
    const activeContainerId = (event.active.data.current as { containerId?: string } | undefined)?.containerId ?? "";
    const base: TodoIndentLevel = parseTodoContainerId(activeContainerId)?.kind === "parent" ? "child" : "root";
    indentBaseRef.current = base;
    indentRef.current = base;
    setIndentTargetId(null);
    setDragging(true);
  }

  function handleDragMove(event: DragMoveEvent): void {
    indentRef.current = resolveIndentLevel(event.delta.x, indentRef.current, indentBaseRef.current);
  }

  function targetPoolFromOver(overContainerId: string, rootAboveId: string | null): TodoPool | null {
    const container = parseTodoContainerId(overContainerId);
    if (container?.kind === "pool") return container.pool;
    if (!rootAboveId) return null;
    if (buckets.today.some((task) => task.id === rootAboveId)) return "today";
    if (buckets.inbox.some((task) => task.id === rootAboveId)) return "inbox";
    return null;
  }

  function handleDragOver(event: DragOverEvent): void {
    const { active, over } = event;
    if (!over || indentRef.current !== "child") {
      setIndentTargetId(null);
      return;
    }
    const activeContainerId = (active.data.current as { containerId?: string } | undefined)?.containerId ?? "";
    const overContainerId = (over.data.current as { containerId?: string } | undefined)?.containerId ?? "";
    const activeId = String(active.id);
    const rootAboveId = hoveredRootIdFromOver(overContainerId, String(over.id), activeContainerId);
    const activeHasChildren = rootIdsWithChildren.has(activeId);
    setIndentTargetId(rootAboveId && rootAboveId !== activeId && !activeHasChildren ? rootAboveId : null);
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setDragging(false);
    const indentLevel = indentRef.current;
    indentRef.current = "root";
    setIndentTargetId(null);
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

    const rootAboveId = hoveredRootIdFromOver(overContainerId, overId, activeContainerId);
    const targetPool = targetPoolFromOver(overContainerId, rootAboveId);
    const activeHasChildren = rootIdsWithChildren.has(activeId);

    const op = resolveTodoDragWithIndent({
      activeContainerId,
      activeParentId,
      activeId,
      activeHasChildren,
      indentLevel,
      rootAboveId,
      targetPool,
    });

    if (!op) return;

    try {
      switch (op.kind) {
        case "reorder": {
          // 父任务容器内重排子任务：children 不在 buckets 里，交给数据层按 parentId 取后回填。
          if (op.containerId.startsWith("parent:")) {
            await reorderChildren(op.containerId.slice("parent:".length), activeId, overId);
            syncAfterWrite();
            break;
          }
          const containerTasks =
            op.containerId === "pool:today"
              ? f(buckets.today)
              : op.containerId === "pool:inbox"
                ? f(buckets.inbox)
                : [];
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
          await moveTaskToParent(activeId, op.parentId);
          setRevealChildren((prev) => ({ id: op.parentId, nonce: (prev?.nonce ?? 0) + 1 }));
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
            await scheduleTask(activeId, localDateString(new Date()));
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
      indentTargetId={indentTargetId}
      revealChildren={revealChildren}
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
        stickyBottomOffsetPx={composerAvoidancePx}
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
            stickyBottomOffsetPx={composerAvoidancePx}
            renderTasks={(tasks) => (
              <TaskList
                pool="inbox"
                tasks={tasks}
                sortable
                containerId="pool:inbox"
                indentTargetId={indentTargetId}
                revealChildren={revealChildren}
                {...rowHandlers}
              />
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
      modifiers={[clampTodoIndentPreview]}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragCancel={() => {
        setDragging(false);
        indentRef.current = "root";
        setIndentTargetId(null);
      }}
    >
      <div className={`min-h-full bg-page text-ink${dragging ? " todo-dnd-dragging" : ""}`}>
        <div
          className="mx-auto w-full max-w-2xl px-4 py-4 lg:max-w-none"
          style={{ paddingBottom: contentBottomPaddingPx }}
        >
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

        <TodoComposer
          tags={tagOptions}
          composerText={composerText}
          onComposerTextChange={setComposerText}
          filterOpen={filterOpen}
          onToggleFilterOpen={() => setFilterOpen((value) => !value)}
          includeTags={includeTags}
          excludeTags={excludeTags}
          tagMode={tagMode}
          notMode={notMode}
          onToggleTag={toggleTag}
          onToggleMode={toggleMode}
          onToggleNotMode={toggleNotMode}
          onClear={clearTags}
          formRef={composerRef}
        />

        {detailId && <TaskDetailSheet id={detailId} onClose={() => setDetailId(null)} onTagsChange={changeTags} />}
      </div>
    </DndContext>
  );
}
