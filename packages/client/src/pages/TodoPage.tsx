import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ActionToastBar } from "../components/ui/ActionToastBar.js";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { db } from "../db/index.js";
import { useActionToast } from "../hooks/useActionToast.js";
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
import { goalBarTaskIds, landsInCollapsedProjectGroup, projectChipIndex } from "../lib/tasks/projectZone.js";
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
import {
  assignTaskToProject,
  findActiveProjectGoalIdForTask,
  ProjectAssignError,
  removeGoalMember,
} from "../lib/goals.js";
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
  preferProjectCollisions,
  resolveIndentLevel,
  resolveTodoDragWithIndent,
  type TodoContainer,
  type TodoIndentLevel,
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
  // 待消费的「展开并滚过去」意图（项目名 chip 回跳 + 落点反馈共用）。
  // 是集合不是单槽：两条分属不同组的成员先后回落时，两次置位若被 React 自动批处理合并，
  // 单槽只会保住最后一个、另一组静默丢掉。消费由 TodoProjectSection 回报（见 onRevealConsumed）。
  const [revealGoals, setRevealGoals] = useState<readonly string[]>([]);
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
    // 传写入后的行：勾选重复模板时 toggleTaskDone 返回的是被完成的那一发（另一条任务），
    // 落点要按它判，不能按动作前的 t 判。
    const next = await toggleTaskDone(t.id);
    await revealProjectHome(next);
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
  const openProject = (goalId: string) =>
    setRevealGoals((prev) => (prev.includes(goalId) ? prev : [...prev, goalId]));
  const consumeReveal = useCallback((goalIds: readonly string[]) => {
    setRevealGoals((prev) => prev.filter((id) => !goalIds.includes(id)));
  }, []);
  /**
   * 项目成员回落 inbox 池时，把它的归属组展开并滚过去。
   *
   * 归属轴排他打开后，「回到 inbox 池」不再等于「出现在收件箱」：成员会落进项目区里一个默认折叠的组，
   * 而组 header 的「还剩 N / 共 M」本来就把它算在内、数字纹丝不动——全屏零反馈，体感是「我把它拖到收件箱，它消失了」。
   * 这里复用项目名 chip 的回跳机制补上落点反馈。非项目成员命中不了 chip，行为一字不变。
   *
   * **入参是写入后的 Task，判据只在这里判一次**：调用方各自判会分裂成动作前的行 / 拖拽意图 / choice.kind
   * 三四种口径，每种都漏一半（这正是本轮修的三个缺陷）。想加新的回落路径，只要把写入结果丢进来。
   */
  const revealProjectHome = async (task: Task) => {
    if (!landsInCollapsedProjectGroup(task, { handSessionId: buckets.handSession?.id ?? null, now: gravityNow })) {
      return;
    }
    const chip = projectChips.get(task.id);
    if (chip) {
      openProject(chip.goalId);
      return;
    }
    // 快路径未命中有两种真实情形：动作前它还是子任务（投影只收根任务），
    // 或它是已完成成员（chip 索引只收未完成）。两种都不在渲染期闭包里，直接问一次库。
    try {
      const goalId = await findActiveProjectGoalIdForTask(task.id);
      if (goalId) openProject(goalId);
    } catch (error) {
      // 落点反馈不是关键路径：DatabaseClosed / 版本升级期查库 reject 就静默降级成"不展开"。
      // 绝不能把它抛回 toggle——TaskRow 的 onToggle 是裸调用，promise 无人接，会变成 unhandled rejection。
      console.warn("[todo] 查项目归属失败，跳过落点反馈:", error);
    }
  };
  const moveToInbox = async (t: Task) => {
    // 函数语义即"送进 inbox"，但落点未必是 inbox 池（已完成 / 在手头的行也走这里），判据交给 revealProjectHome。
    const next = await unscheduleTask(t.id);
    await revealProjectHome(next);
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
    // 判据要读解绑之后的行：动作前它的 sessionId 还等于活跃场，
    // 按那份行判会被 revealProjectHome 的手头闸误判成「本来就看得见」，反而一条都不 reveal。
    void (async () => {
      const next = await releaseTaskFromHand(t.id);
      await revealProjectHome(next);
    })();
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
  const { toast: actionToast, showToast: showActionToast, clearToast: clearActionToast } = useActionToast();
  // 当前被拖的任务：项目组按它画「可落 / 不可落」两态。存 id 而不是整行，
  // 免得 useLiveQuery 刷新后手里攥着一份过期的行。allTasks 已含项目区成员，不另开查询（design §数据源）。
  const [dragCandidateId, setDragCandidateId] = useState<string | null>(null);
  const dragCandidate = dragCandidateId === null ? null : (allTasks.find((t) => t.id === dragCandidateId) ?? null);
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
    setDragCandidateId(String(event.active.id));
  }

  function handleDragMove(event: DragMoveEvent): void {
    indentRef.current = resolveIndentLevel(event.delta.x, indentRef.current, indentBaseRef.current);
  }

  function targetContainerFromOver(overContainerId: string, rootAboveId: string | null): TodoContainer | null {
    const container = parseTodoContainerId(overContainerId);
    // 池容器与项目组容器都是直接落点；parent 容器不是（它要按下面的根行反查它所在的池）。
    if (container?.kind === "pool" || container?.kind === "project") return container;
    if (!rootAboveId) return null;
    if (buckets.today.some((task) => task.id === rootAboveId)) return { kind: "pool", pool: "today" };
    if (floatingInbox.some((task) => task.id === rootAboveId)) return { kind: "pool", pool: "inbox" };
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
    setDragCandidateId(null);
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
    const targetContainer = targetContainerFromOver(overContainerId, rootAboveId);
    const activeHasChildren = rootIdsWithChildren.has(activeId);

    const op = resolveTodoDragWithIndent({
      activeContainerId,
      activeParentId,
      activeId,
      activeHasChildren,
      indentLevel,
      rootAboveId,
      targetContainer,
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
          // 子任务被投影层整个丢掉（只收根任务），所以升根前它不在 chips 里；
          // 升根后若它本就是某 active project 的成员，会直接落进折叠的组。
          // 判据必须读 promoteToRoot 的返回行而不是 op.pool（那是拖拽**意图**）：
          // promoteToRoot 不动 done/recurrence，把一条已完成子任务拖进收件箱是可达手势，落点其实是「已完成」。
          const promoted = await promoteToRoot(activeId, op.pool, sortOrder);
          await revealProjectHome(promoted);
          break;
        }
        case "schedule-root": {
          if (op.pool === "today") {
            await scheduleTask(activeId, localDateString(new Date()));
          } else {
            // 拖进 pool:inbox 不经 moveToInbox，落点反馈要在这里补一遍（同 revealProjectHome 的理由）。
            const unscheduled = await unscheduleTask(activeId);
            await revealProjectHome(unscheduled);
          }
          break;
        }
        case "assign-to-project": {
          try {
            await assignTaskToProject(op.goalId, activeId);
          } catch (error) {
            // 准入/满员/目标组失效是**可预期**的用户操作结果，说出原因。
            // 成功路径刻意不做 revealProjectHome：落点就在手指下方，自动展开会在连续拖入第二条时
            // 改变布局、让下一条的落点跑掉（design §动作二「成功反馈：不展开组」）。
            if (error instanceof ProjectAssignError) {
              showActionToast({ message: error.message });
              break;
            }
            // 其余错误里有一类是用户可达且会永远复现的：目标组的裸行过不了 GoalSchema.parse
            //（members 有重复 ref / prerequisites 有悬空边，跨设备并发与 force-push 都能造出来）。
            // 红线 3 保证这种组照常渲染成落点，用户拖多少次都一样——静默吞掉等于"应用坏了"。
            console.error("[todo] 归入项目失败:", error);
            showActionToast({ message: "这个项目的数据有点问题，暂时加不进去" });
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
      revealGoals={revealGoals}
      onRevealConsumed={consumeReveal}
      onExitProject={exitProject}
      dragCandidate={dragCandidate}
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
      collisionDetection={(args) => preferProjectCollisions(pointerWithin(args), closestCenter(args))}
      modifiers={[clampTodoIndentPreview]}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragCancel={() => {
        setDragging(false);
        setDragCandidateId(null);
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

        {/* 贴着 composer 上沿浮起：composerAvoidancePx = composer 高 + 底部导航高，
            与 DayGroupedList 的 sticky 头同源，保证 toast 不被输入框压住。 */}
        <div className="pointer-events-none fixed inset-x-0 z-30 px-4" style={{ bottom: composerAvoidancePx + 8 }}>
          <div className="pointer-events-auto mx-auto w-full max-w-2xl">
            <ActionToastBar toast={actionToast} onDismiss={clearActionToast} ariaLabel="待办操作反馈" />
          </div>
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

        {detailId && (
          <TaskDetailSheet
            id={detailId}
            onClose={closeDetail}
            onTagsChange={changeTags}
            onTimeChanged={(task) => void revealProjectHome(task)}
          />
        )}
      </div>
    </DndContext>
  );
}
