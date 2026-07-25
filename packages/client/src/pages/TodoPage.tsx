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
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
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
  bumpTaskWeight,
  deleteTaskCascade,
  listTasks,
  markOccurrenceSkipped,
  moveTaskToParent,
  persistTaskOrder,
  promoteToRoot,
  reorderChildren,
  runMaterialization,
  scheduleTask,
  setTaskTags,
  type TodoBuckets,
  toggleTaskDone,
  unscheduleTask,
} from "../lib/tasks.js";
import { goalBarTaskIds, projectChipIndex } from "../lib/tasks/projectZone.js";
import { splitInboxByGravity } from "../lib/tasks/gravity.js";
import type { GravitySurfacedMap } from "../lib/tasks/gravity.js";
import { markGravityTasksSurfaced, useGravitySurfacedMap } from "../lib/tasks/gravityReviewStorage.js";
import { currentGravityDate, msUntilNextLocalDay } from "../lib/tasks/gravityClock.js";
import { useTodoGravitySettings } from "../lib/settings/todoGravitySetting.ts";
import {
  endActiveSession,
  grabTaskToHand,
  healActiveSessions,
  listResumableSessions,
  releaseTaskFromHand,
  resumeSession,
} from "../lib/sessions.js";
import { findActiveProjectGoalIdForTask, removeGoalMember } from "../lib/goals.js";
import { useIsWideScreen } from "../lib/useIsWideScreen.js";
import { AtHandSection } from "./todo/AtHandSection.js";
import { CollapsibleSection } from "./todo/CollapsibleSection.js";
import { DayGroupedList } from "./todo/DayGroupedList.js";
import { GravityReviewSection } from "./todo/GravityReviewSection.js";
import { SunkenInboxTail, makeSunkenExtraAction } from "./todo/SunkenInboxTail.js";
import { SunkenScheduledTail } from "./todo/SunkenScheduledTail.js";
import { ResizableSplit } from "./todo/ResizableSplit.js";
import { TaskColumn } from "./todo/TaskColumn.js";
import { TaskDetailSheet } from "./todo/TaskDetailSheet.js";
import { TaskList } from "./todo/TaskList.js";
import { TodoComposer } from "./todo/TodoComposer.js";
import { ProjectNameChip, ProjectZoneIntroBar, TodoProjectSection } from "./todo/TodoProjectSection.js";
import {
  clampTodoIndentPreview,
  hoveredRootIdFromOver,
  parseTodoContainerId,
  resolveIndentLevel,
  resolveTodoDragWithIndent,
  type TodoIndentLevel,
  type TodoPool,
} from "./todo/todoDnd.js";

const EMPTY: TodoBuckets = {
  today: [],
  inbox: [],
  scheduled: [],
  recurring: [],
  completed: [],
  scheduledSunkenFromIndex: 0,
  atHand: [],
  handSession: null,
  projects: [],
  goalLinkedIds: new Set<string>(),
};
const TODO_COMPOSER_CONTENT_GAP_PX = 24;

export function TodoPage() {
  // 单一时钟：四分区 / 逾期 / 重力水位线共用 gravityNow，跨日由下方 timer+focus+visibilitychange 刷新后整页重算。
  const [gravityNow, setGravityNow] = useState(() => currentGravityDate());
  const buckets = useLiveQuery(() => listTasks(gravityNow), [gravityNow], EMPTY) ?? EMPTY;
  // 项目成员用可点的项目名 chip 表达归属，绿竖条退回只表达 theme 归属——同屏两种说法是重复信号。
  const projectChips = projectChipIndex(buckets.projects);
  const goalLinkedIds = goalBarTaskIds(buckets.goalLinkedIds, projectChips);
  const resumable = useLiveQuery(() => listResumableSessions(), []) ?? [];
  useEffect(() => {
    void healActiveSessions();
  }, [buckets.handSession?.id]);
  const [searchParams, setSearchParams] = useSearchParams();
  const taskIdParam = searchParams.get("taskId");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"and" | "or">("and");
  const [filterOpen, setFilterOpen] = useState(false);
  const [notMode, setNotMode] = useState(false);
  const [composerText, setComposerText] = useState("");
  // 项目名 chip 的回跳目标；nonce 让「连点同一个 chip」也能重新触发展开与滚动。
  const [revealGoal, setRevealGoal] = useState<{ id: string; nonce: number } | null>(null);
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
  const { hidden: navHidden } = useBottomNav();
  const wide = useIsWideScreen();
  const rootIdsWithChildren =
    useLiveQuery(async () => {
      const children = await db.tasks.filter((task) => task.parentId !== null).toArray();
      return new Set(children.map((child) => child.parentId).filter((id): id is string => Boolean(id)));
    }, []) ?? new Set<string>();
  const navOffsetPx = !wide && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0;
  const composerHiddenByScroll = !wide && navHidden;
  const composerAvoidancePx = Math.ceil((composerHiddenByScroll ? 0 : composerHeightPx) + navOffsetPx);
  const contentBottomPaddingPx = Math.max(192, composerAvoidancePx + TODO_COMPOSER_CONTENT_GAP_PX);
  const deepLinkedTask = useLiveQuery(
    async () => {
      if (!taskIdParam) return null;
      return (await db.tasks.get(taskIdParam)) ?? null;
    },
    [taskIdParam],
    undefined,
  );

  useEffect(() => {
    if (!taskIdParam) return;
    if (deepLinkedTask === undefined) return;
    setDetailId(deepLinkedTask?.id ?? null);
  }, [deepLinkedTask, taskIdParam]);

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
    const next = await toggleTaskDone(t.id);
    // 取消勾选后若回落 inbox 池，它会进项目区里一个默认折叠的组——同 revealProjectHome 的理由。
    // 排到未来的成员回的是已排期区、本来就看得见，不展开（红线 4：reveal 必须带落点判据）。
    if (!next.done && placementForTask(next, gravityNow).pool === "inbox") await revealProjectHome(next.id);
  };
  const remove = async (t: Task) => {
    // recurrence===null 是 markOccurrenceSkipped 的前置条件：混合体行（ruleId/recurrence 都非空）
    // 撞它必抛，而这里是 fire-and-forget，用户只会看到"点了没反应"。故混合体走 cascade 兜底。
    if (t.ruleId !== null && t.recurrence === null) {
      await markOccurrenceSkipped(t.id);
    } else {
      // 级联删除：模板连清子任务+活跃 occurrence；普通父任务连清子任务（旧 deleteTask 会孤儿化两者）
      await deleteTaskCascade(t.id);
    }
    if (detailId === t.id) setDetailId(null);
  };
  const openDetail = (t: Task) => setDetailId(t.id);
  const closeDetail = () => {
    setDetailId(null);
    if (!taskIdParam) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("taskId");
      return next;
    });
  };
  const openProject = (goalId: string) => setRevealGoal((prev) => ({ id: goalId, nonce: (prev?.nonce ?? 0) + 1 }));
  /**
   * 项目成员回落 inbox 池时，把它的归属组展开并滚过去。
   *
   * 归属轴排他打开后，「回到 inbox 池」不再等于「出现在收件箱」：成员会落进项目区里一个默认折叠的组，
   * 而组 header 的「还剩 N / 共 M」本来就把它算在内、数字纹丝不动——全屏零反馈，体感是「我把它拖到收件箱，它消失了」。
   * 这里复用项目名 chip 的回跳机制补上落点反馈。非项目成员命中不了 chip，行为一字不变。
   */
  const revealProjectHome = async (taskId: string) => {
    const chip = projectChips.get(taskId);
    if (chip) {
      openProject(chip.goalId);
      return;
    }
    // 快路径未命中有两种真实情形：动作前它还是子任务（投影只收根任务），
    // 或它是已完成成员（chip 索引只收未完成）。两种都不在渲染期闭包里，直接问一次库。
    const goalId = await findActiveProjectGoalIdForTask(taskId);
    if (goalId) openProject(goalId);
  };
  const moveToInbox = async (t: Task) => {
    await unscheduleTask(t.id);
    await revealProjectHome(t.id);
  };
  const moveToToday = async (t: Task) => {
    await scheduleTask(t.id, localDateString(new Date()));
  };
  const changeTags = async (t: Task, tags: string[]) => {
    await setTaskTags(t.id, tags);
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
    const p = placementForTask(t, gravityNow);
    return p.pool === "today" && p.overdue;
  };

  const gravitySettings = useTodoGravitySettings();
  const surfacedMap = useGravitySurfacedMap();
  useEffect(() => {
    let timer: number | undefined;
    const refreshGravityNow = () => {
      const now = currentGravityDate();
      setGravityNow(now);
      void runMaterialization(now).catch((error) => console.error("[todo] occurrence materialization failed:", error));
    };
    const schedule = () => {
      timer = window.setTimeout(() => {
        refreshGravityNow();
        schedule();
      }, msUntilNextLocalDay(currentGravityDate()));
    };
    schedule();
    const refreshOnVisible = () => {
      if (document.visibilityState !== "hidden") refreshGravityNow();
    };
    window.addEventListener("focus", refreshGravityNow);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", refreshGravityNow);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, []);
  const { floating: floatingInbox, sunken: sunkenInbox } = splitInboxByGravity(
    buckets.inbox,
    gravitySettings,
    gravityNow,
  );

  const bumpWeight = async (t: Task) => {
    await bumpTaskWeight(t.id);
  };

  const markSurfaced = async (ids: string[], now: Date): Promise<GravitySurfacedMap> => {
    return markGravityTasksSurfaced(ids, now, { waterlineDays: gravitySettings.waterlineDays });
  };

  const releaseFromHand = (t: Task) => {
    // 只对「会落回 inbox 池」的成员 reveal：有排期的移出手头后去今天 / 已排期区，那里带项目名 chip、本来就看得见，
    // 强行展开反而会把页面滚到项目区。判据直接复用页面内既有的 placementForTask（逾期的一次性任务同样回落 inbox）。
    const fallsBackToInbox = placementForTask(t, gravityNow).pool === "inbox";
    void releaseTaskFromHand(t.id);
    if (fallsBackToInbox) void revealProjectHome(t.id);
  };
  const grabToHand = (t: Task) => void grabTaskToHand(t.id);
  const endHand = () => void endActiveSession();
  const resumeHand = (sessionId: string) => void resumeSession(sessionId);
  const exitProject = (goalId: string, t: Task) => void removeGoalMember(goalId, { kind: "task", id: t.id });
  const projectMetaChip = (t: Task): ReactNode => {
    const chip = projectChips.get(t.id);
    return chip ? <ProjectNameChip chip={chip} onOpen={openProject} /> : null;
  };

  const rowHandlers = {
    onToggle: toggle,
    onEdit: openDetail,
    onDelete: remove,
    onToToday: moveToToday,
    onToInbox: moveToInbox,
    onToHand: grabToHand,
    onTagsChange: changeTags,
  };

  // 项目区成员一并纳入：P2 打开归属轴排他后它们会离开 inbox，
  // 不纳入的话筛选栏的标签候选会随着圈组而缩水。
  const allTasks: Task[] = Array.from(
    new Map(
      [
        ...buckets.today,
        ...buckets.inbox,
        ...buckets.scheduled,
        ...buckets.recurring,
        ...buckets.projects.flatMap((group) => group.tasks),
      ].map((t) => [t.id, t]),
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
    if (floatingInbox.some((task) => task.id === rootAboveId)) return "inbox";
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
            break;
          }
          const containerTasks =
            op.containerId === "pool:today"
              ? f(buckets.today)
              : op.containerId === "pool:inbox"
                ? f(floatingInbox)
                : [];
          if (containerTasks.length === 0) return;
          const ids = containerTasks.map((t) => t.id);
          const oldIndex = ids.indexOf(activeId);
          const newIndex = ids.indexOf(overId);
          if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
          const ordered = arrayMove(ids, oldIndex, newIndex);
          await persistTaskOrder(ordered);
          break;
        }
        case "move-to-parent": {
          await moveTaskToParent(activeId, op.parentId);
          setRevealChildren((prev) => ({ id: op.parentId, nonce: (prev?.nonce ?? 0) + 1 }));
          break;
        }
        case "promote-to-root": {
          const targetTasks = op.pool === "today" ? f(buckets.today) : f(floatingInbox);
          const sortOrder = targetTasks.length > 0 ? Math.max(...targetTasks.map((t) => t.sortOrder)) + 1 : 0;
          await promoteToRoot(activeId, op.pool, sortOrder);
          // 子任务被投影层整个丢掉（只收根任务），所以升根前它不在 chips 里；
          // 升根后若它本就是某 active project 的成员，会直接落进折叠的组。
          if (op.pool === "inbox") await revealProjectHome(activeId);
          break;
        }
        case "schedule-root": {
          if (op.pool === "today") {
            await scheduleTask(activeId, localDateString(new Date()));
          } else {
            // 拖进 pool:inbox 不经 moveToInbox，落点反馈要在这里补一遍（同 revealProjectHome 的理由）。
            await unscheduleTask(activeId);
            await revealProjectHome(activeId);
          }
          break;
        }
      }
    } catch (err) {
      void err;
    }
  }

  // 项目区不过 f()：与手头区一致，标签筛选与搜索本期不覆盖项目区（design §非目标）。
  // 提示条的两个数必须同口径：`memberCount` 只数未完成成员，`groupCount` 若数全部组（含「全部完成」的组），
  // 「1 条任务已归入 2 个项目」这种自相矛盾的话就是可达的。
  const projectGroupsWithPending = buckets.projects.filter((group) => group.tasks.length > 0);
  const projectMemberCount = projectGroupsWithPending.reduce((sum, group) => sum + group.tasks.length, 0);
  const projectsBlock = (
    <TodoProjectSection
      groups={buckets.projects}
      handSessionId={buckets.handSession?.id ?? null}
      now={gravityNow}
      revealGoal={revealGoal}
      onExitProject={exitProject}
      {...rowHandlers}
    />
  );

  const atHandBlock = (
    <AtHandSection
      atHand={buckets.atHand}
      session={buckets.handSession}
      resumable={resumable}
      onRelease={releaseFromHand}
      onEndSession={endHand}
      onResume={resumeHand}
      onToggle={toggle}
      onEdit={openDetail}
      goalLinkedIds={goalLinkedIds}
      metaChip={projectMetaChip}
    />
  );

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
      metaChip={projectMetaChip}
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

  const gravityReviewBlock = (
    <GravityReviewSection
      sunkenTasks={sunkenInbox}
      settings={gravitySettings}
      surfaced={surfacedMap}
      now={gravityNow}
      onMarkSurfaced={markSurfaced}
      onBump={bumpWeight}
      goalLinkedIds={goalLinkedIds}
      {...rowHandlers}
    />
  );

  const inboxFiltered = f(floatingInbox);
  const sunkenFiltered = f(sunkenInbox);
  const sunkenExtraAction = makeSunkenExtraAction(bumpWeight);
  const inboxBlock = (
    <section data-section="inbox">
      {/* 说明条挂在收件箱顶部而非项目区顶部：任务是从这里消失的，解释要贴着消失的地方。 */}
      <ProjectZoneIntroBar memberCount={projectMemberCount} groupCount={projectGroupsWithPending.length} />
      <CollapsibleSection
        title="收件箱"
        count={inboxFiltered.length}
        defaultOpen={!getInboxCollapsed()}
        onToggle={(open) => setInboxCollapsed(!open)}
      >
        {inboxFiltered.length === 0 && sunkenFiltered.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">收件箱为空</p>
        ) : (
          <DayGroupedList
            segments={groupInboxByDay(inboxFiltered)}
            stickyBottomOffsetPx={composerAvoidancePx}
            expandedFooter={
              <SunkenInboxTail
                sunkenTasks={sunkenFiltered}
                stickyBottomOffsetPx={composerAvoidancePx}
                extraAction={sunkenExtraAction}
                goalLinkedIds={goalLinkedIds}
                {...rowHandlers}
              />
            }
            renderTasks={(tasks) => (
              <TaskList
                pool="inbox"
                tasks={tasks}
                sortable
                containerId="pool:inbox"
                indentTargetId={indentTargetId}
                revealChildren={revealChildren}
                goalLinkedIds={goalLinkedIds}
                {...rowHandlers}
              />
            )}
          />
        )}
      </CollapsibleSection>
    </section>
  );

  const scheduledFiltered = f(buckets.scheduled);
  // 7 天水位线：过滤激活时失效（命中即显示），否则水下折叠进 SunkenScheduledTail。
  const scheduledFilterActive = composerText.trim() !== "" || includeTags.length > 0 || excludeTags.length > 0;
  const scheduledSurface = scheduledFilterActive
    ? scheduledFiltered
    : buckets.scheduled.slice(0, buckets.scheduledSunkenFromIndex);
  const scheduledSunken = scheduledFilterActive ? [] : buckets.scheduled.slice(buckets.scheduledSunkenFromIndex);
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
        <div className="rounded-card p-1.5">
          {scheduledSurface.length > 0 && (
            <TaskList pool="upcoming" tasks={scheduledSurface} metaChip={projectMetaChip} {...rowHandlers} />
          )}
          <SunkenScheduledTail sunkenTasks={scheduledSunken} metaChip={projectMetaChip} {...rowHandlers} />
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
                  {atHandBlock}
                  {todayBlock}
                  {gravityReviewBlock}
                  {completedBlock}
                </>
              }
              right={
                <>
                  {scheduledBlock}
                  {projectsBlock}
                  {inboxBlock}
                </>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {atHandBlock}
              {todayBlock}
              {gravityReviewBlock}
              {completedBlock}
              {scheduledBlock}
              {projectsBlock}
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
          bottomOffsetPx={navOffsetPx}
          hiddenByScroll={composerHiddenByScroll}
          formRef={composerRef}
        />

        {detailId && <TaskDetailSheet id={detailId} onClose={closeDetail} onTagsChange={changeTags} />}
      </div>
    </DndContext>
  );
}
