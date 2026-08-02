import {
  closestCenter,
  DndContext,
  type DragEndEvent,
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
import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ActionToastBar } from "../components/ui/ActionToastBar.js";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { db } from "../db/index.js";
import { useActionToast } from "../hooks/useActionToast.js";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useKeyboardHeight } from "../hooks/useKeyboardHeight.ts";
import { composeBottomInset } from "../lib/bottomInset.ts";
import { hapticDestructive, hapticDrop, hapticGrab, hapticToggle } from "../lib/haptics.ts";
import { projectAssignBlock, projectAssignBlockMessage } from "../lib/tasks/goalMembership.js";
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
import { nestTaskUnderParent, promoteTaskToHand } from "../lib/taskNesting.js";
import { goalBarTaskIds, landsInCollapsedProjectGroup, projectChipIndex } from "../lib/tasks/projectZone.js";
import { applyOptimisticOrder } from "../lib/tasks/reorderDisplay.js";
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
  updateSessionNote,
} from "../lib/sessions.js";
import {
  assignTasksToProject,
  assignTaskToProject,
  createProjectWithMembers,
  createTaskForProject,
  findActiveProjectGoalIdForTask,
  prerequisiteLossOnAssign,
  prerequisiteLossOnAssignMany,
  ProjectAssignError,
  removeGoalMember,
  updateGoal,
} from "../lib/goals.js";
import { useIsWideScreen } from "../lib/useIsWideScreen.js";
import { AtHandSection } from "./todo/AtHandSection.js";
import { TodoDragDock } from "./todo/TodoDragDock.js";
import { applyTodoDockDrop } from "./todo/todoDockDrop.js";
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
import { TodoSelectionBar } from "./todo/TodoSelectionBar.js";
import { ProjectNameChip, TodoProjectSection } from "./todo/TodoProjectSection.js";
import {
  clampTodoIndentPreview,
  hoveredRootIdFromOver,
  parseTodoContainerId,
  preferProjectCollisions,
  laneToIndentLevel,
  resolveTodoDockDrop,
  resolveTodoDragLaneAtPointer,
  resolveTodoDragWithIndent,
  type TodoContainer,
  type TodoDragLane,
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
  atHandPendingTotal: 0,
  handSession: null,
  projects: [],
  projectTints: new Map<string, string>(),
  goalLinkedIds: new Set<string>(),
};
const TODO_COMPOSER_CONTENT_GAP_PX = 24;
/**
 * `TodoSelectionBar` 的占位高度下限（px）：卡片 `px-3 py-2` + 一行控件，实测约 42。
 * 只当兜底——量得到 composer 高度时取两者的大者，见 `bottomBarHeightPx`。
 */
const TODO_SELECTION_BAR_HEIGHT_PX = 44;

export function TodoPage() {
  // 单一时钟：四分区 / 逾期 / 重力水位线共用 gravityNow，跨日由下方 timer+focus+visibilitychange 刷新后整页重算。
  const [gravityNow, setGravityNow] = useState(() => currentGravityDate());
  const buckets = useLiveQuery(() => listTasks(gravityNow), [gravityNow], EMPTY) ?? EMPTY;
  // 项目成员用可点的项目名 chip 表达归属，绿竖条退回只表达 theme 归属——同屏两种说法是重复信号。
  const projectChips = projectChipIndex(buckets.projects, buckets.projectTints);
  const goalLinkedIds = goalBarTaskIds(buckets.goalLinkedIds, projectChips);
  const resumable = useLiveQuery(() => listResumableSessions(), []) ?? [];
  useEffect(() => {
    void healActiveSessions();
  }, [buckets.handSession?.id]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const taskIdParam = searchParams.get("taskId");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"and" | "or">("and");
  const [filterOpen, setFilterOpen] = useState(false);
  const [notMode, setNotMode] = useState(false);
  const [composerText, setComposerText] = useState("");
  /**
   * 收件箱的展开态由页面持有一份 state，不能像另外两个折叠区那样每次渲染现读 localStorage。
   *
   * 理由是这一处**要被程序打开**（进多选时，见 `enterSelection`），而 `<details open>` 是
   * React 的受控值：用户手动折叠只改 DOM 与 localStorage、不触发重渲染，React 手上仍是上一次
   * 渲染的 `true`。此时只写 localStorage 的话，下一帧算出的 `open` 还是 `true`——与 React 记着的
   * 值相同 → 它认为没变、根本不碰 DOM → 收件箱还收着，"进多选顺带展开"形同虚设。
   * 存成 state 后每次开合都过 React 一遍，两边不会各说各话。localStorage 仍写，负责跨会话持久化。
   */
  const [inboxOpen, setInboxOpen] = useState(() => !getInboxCollapsed());
  // 页面级多选态（design §动作一）。selectedIds 只存 id：useLiveQuery 回流后手里攥着的整行会过期。
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // 待消费的「展开并滚过去」意图（项目名 chip 回跳 + 落点反馈共用）。
  // 是集合不是单槽：两条分属不同组的成员先后回落时，两次置位若被 React 自动批处理合并，
  // 单槽只会保住最后一个、另一组静默丢掉。消费由 TodoProjectSection 回报（见 onRevealConsumed）。
  const [revealGoals, setRevealGoals] = useState<readonly string[]>([]);
  // 拖拽期间挂 todo-dnd-dragging：临时解除 .swipeable-list-item 的 overflow:hidden，
  // 否则 dnd-kit 的 translateY 会被裁掉、被拖/让位的行隐身（index.css 有对应规则）。
  const [dragging, setDragging] = useState(false);
  const laneRef = useRef<TodoDragLane>("root");
  // 被拖项自身的缩进基线：拖根任务=root（向右变子），拖子任务=child（向左升级为根）。
  const indentBaseRef = useRef<TodoIndentLevel>("root");
  // 键盘拖拽标记：键盘 sensor 的跨栏移动本身就是一大段横向位移,不标记会被车道判定误认成左拉出坞。
  // 守卫显式落在纯函数里,不靠"键盘不发 pointermove、坐标恰好没动"这种隐式行为兜底。
  const keyboardDragRef = useRef(false);
  // 拖起时的指针视口坐标。车道判定吃的是位移(相对起手点),而坞画在绝对位置——要判"指针是不是在坞上"
  // 就得把两者换算到同一坐标系,起点即这一份。量不到(键盘/异常路径)记 null,holdDock 恒 false。
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  // 指针当前视口坐标,由原生 pointermove/touchmove 直接喂(见下方 useEffect)。**不能改回 dnd-kit
  // 的 event.delta**:那是过 modifiers 之后的值,出坞要的负位移被 clampTodoIndentPreview 钳没了
  // (理由详见 resolveTodoDragLaneAtPointer 注释)。
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  // 坞容器,用来取它的真实矩形:坞垂直居中、高度随药丸数量变,横向带宽算得出、纵向范围只能量。
  const dockElRef = useRef<HTMLUListElement | null>(null);
  // dock 车道离散 state：只在越档时变化(setState 同值跳过渲染),驱动坞的细条↔完整形态。
  const [dockEngaged, setDockEngaged] = useState(false);
  const [indentTargetId, setIndentTargetId] = useState<string | null>(null);
  const [revealChildren, setRevealChildren] = useState<{ id: string; nonce: number } | null>(null);
  // 拖拽落库前的乐观重排：containerId → 该容器的最新渲染序。放手瞬间先同步渲染新序，
  // 让 dnd-kit 的 transform 归位动画直接作用在新序上，避免「先弹回原位再硬跳」的两段视觉。
  const [optimisticOrder, setOptimisticOrder] = useState<{ containerId: string; orderedIds: string[] } | null>(null);
  // 乐观序在落库后的下一次 liveQuery 回流时收敛：回流后 buckets 已是新序（或外部同步改动覆盖），
  // 清除后渲染结果不变，无跳变；落库失败由 reorder 分支 catch 里清。
  // void buckets 是显式声明依赖意图：本 effect 的触发信号就是 buckets 引用变化（一次回流）。
  useEffect(() => {
    void buckets;
    setOptimisticOrder(null);
  }, [buckets]);
  const composerRef = useRef<HTMLFormElement>(null);
  const [composerHeightPx, setComposerHeightPx] = useState(0);
  const { hidden: navHidden, setHidden: setNavHidden } = useBottomNav();
  const wide = useIsWideScreen();
  // 此前 Todo 页无键盘避让，本任务补上：并入 composerAvoidancePx 的合成（见下方），收起为 0。
  const keyboardHeightPx = useKeyboardHeight();
  const rootIdsWithChildren =
    useLiveQuery(async () => {
      const children = await db.tasks.filter((task) => task.parentId !== null).toArray();
      return new Set(children.map((child) => child.parentId).filter((id): id is string => Boolean(id)));
    }, []) ?? new Set<string>();
  // 键盘弹起时 nav 不该再占避让空间，故加 keyboardHeightPx===0 守卫；键盘收起
  // （桌面浏览器恒如此）时 = 原公式，逐值不变，安全不变量守住（fix round 1，见 task-3-report.md）。
  // 与下方「收起 nav 实体」的 effect 是两回事：本条只管避让量，effect 才动 nav 本身；
  // effect 结算前的那一帧也靠本守卫兜住，避免输入条闪跳。
  const navOffsetPx = !wide && !navHidden && keyboardHeightPx === 0 ? BOTTOM_NAV_HEIGHT_PX : 0;
  const composerHiddenByScroll = !wide && navHidden;
  /**
   * 底部**实际占位者**的高度。照 QuickNotesPage 的 `bottomInsetPx` 那条路子：避让量按「此刻底部
   * 站着谁」算，不是按 composer 一个人算。
   *
   * 多选态下站着的是 `TodoSelectionBar`，它 `hiddenByScroll` 管不着、滚动时原地不动。
   * 只看 `composerHiddenByScroll` 会在窄屏滚动后把避让量归零，而操作栏还占着底部约 42px，
   * 与 toast 容器同为 `Z.backdrop`(40) 且在 DOM 里排其后 → 后绘制 → 把 toast 完全盖住。
   * 多选态下 toast 是唯一的失败反馈通道（两种提交失败都不退出多选、只靠它说原因），
   * 盖住就等于「点了没反应」。同一个量还喂 `DayGroupedList` 的 sticky「收起」，一并跟着修正。
   *
   * 取 `max(上次量到的 composer 高, 常量)` 而不是给操作栏另开一套测量：两者高度本就相近
   *（见下方操作栏处的注释），常量只是兜住「量不到高度」的场景（首帧、jsdom）——
   * 这条避让的唯一职责是别把 toast 压住，宁可多留几像素。
   */
  const bottomBarHeightPx = selectionMode
    ? Math.max(composerHeightPx, TODO_SELECTION_BAR_HEIGHT_PX)
    : composerHiddenByScroll
      ? 0
      : composerHeightPx;
  // 底部避让量单一合成来源（composeBottomInset，见 lib/bottomInset.ts，与 QuickNotesPage 共用）：
  // bottomBarHeightPx/navOffsetPx 仍是本页私有的「此刻底部站着谁」判断，这里只把结果连同键盘高
  // 一起喂进合成。keyboardHeightPx=0（桌面浏览器 / 键盘收起）时 = Math.ceil(bottomBarHeightPx +
  // navOffsetPx)，与合成前的批 1 值逐值相等，见 bottomInset.test.ts 回归护栏。
  const composerAvoidancePx = composeBottomInset({ barHeightPx: bottomBarHeightPx, navOffsetPx, keyboardHeightPx });
  const contentBottomPaddingPx = Math.max(192, composerAvoidancePx + TODO_COMPOSER_CONTENT_GAP_PX);
  // TodoComposer/TodoSelectionBar 自身的 bottom 定位（fix round 1）：这两个元素就是底部固定条本身，
  // 不需要再叠一层 barHeightPx，故传 0；navOffsetPx 已被上方守卫（键盘弹起时归 0），键盘弹起时
  // fixedBarBottomPx = keyboardHeightPx，输入条稳贴键盘上沿；keyboard=0 时 = navOffsetPx，与本轮前
  // 完全一致。TodoSelectionBar 内有「项目名」输入框，多选态点它同样会弹键盘（见
  // todo/TodoSelectionBar.tsx 的 `<input aria-label="项目名">`），故这里走同一合成、计入
  // keyboardHeightPx 是必要的——不是「反正不会有文字输入所以不变」。
  const fixedBarBottomPx = composeBottomInset({ barHeightPx: 0, navOffsetPx, keyboardHeightPx });
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

  // 键盘弹起时收起底栏**实体**。只把 navOffsetPx 守卫成 0 不够——那改的是避让量，nav 那 49px 仍在
  // 流里占位；Keyboard resize:none 下 webview 不 reflow，它就实打实杵在输入条与键盘之间
  //（用户报「待办页输入框和输入法之间隔着一条 tab 行」）。速记页早有同款（QuickNotesPage 的
  // inputInteractionActive effect），本页此前漏了。
  //
  // 用 ref 记「这次隐藏是键盘引起的」，而不是无条件 setNavHidden(keyboardHeightPx > 0)：挂载时键盘
  // 恒为 0，无条件写会把进场时已有的隐藏态冲掉——App 层滚动驱动（useHideBottomNavOnScroll）刚藏起来
  // 的底栏会瞬间弹回。TodoPage.test.tsx 的 hideBottomNav 用例正是钉这条。
  const navHiddenByKeyboardRef = useRef(false);
  useEffect(() => {
    if (keyboardHeightPx > 0) {
      navHiddenByKeyboardRef.current = true;
      setNavHidden(true);
      return;
    }
    // 键盘收起：只有当初是自己藏的才恢复，否则不碰——底栏归滚动驱动管。
    if (!navHiddenByKeyboardRef.current) return;
    navHiddenByKeyboardRef.current = false;
    setNavHidden(false);
  }, [keyboardHeightPx, setNavHidden]);

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
    hapticToggle();
    // 传写入后的行：勾选重复模板时 toggleTaskDone 返回的是被完成的那一发（另一条任务），
    // 落点要按它判，不能按动作前的 t 判。
    const next = await toggleTaskDone(t.id);
    await revealProjectHome(next);
  };
  const remove = async (t: Task) => {
    hapticDestructive();
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
    // replace 而非 push：关抽屉不该多一条历史，否则手机返回键会把抽屉重新弹开。
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("taskId");
        return next;
      },
      { replace: true },
    );
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

  const enterSelection = () => {
    setSelectionMode(true);
    setSelectedIds(new Set());
    // 顺带展开收件箱。入口「圈成项目」挂在 `<summary>` 里、与 `<details open>` 无关，而折叠状态
    // 是持久化的：折叠着点进多选，全页其余区块变灰 inert + 底部「已选 0 条」，收件箱却还收着——
    // 一条可选行都看不见，第一眼是「模式坏了」。
    // 两处都写：`inboxOpen` 是 `<details open>` 的受控值（光写 localStorage 不够，理由见它的声明处），
    // localStorage 负责跨会话。代价是把用户的折叠偏好改成展开——可以接受，他点「圈成项目」就是要看收件箱。
    setInboxOpen(true);
    setInboxCollapsed(false);
  };
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelect = (task: Task) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };
  const selectionProps = { selectionMode, selectedIds, onToggleSelect: toggleSelect };
  /**
   * 当前可选的 id 全集。收件箱三处渲染点合起来就是它：浮动区 `floatingInbox`、水下尾 `sunkenInbox`、
   * 重力复习区用的也是 `sunkenInbox`。非多选态不算（省掉每次渲染一趟 O(n) 建集）。
   *
   * 不用 `buckets.inbox`（此刻两者恒等）而是照着渲染点写：将来哪一处改了口径（比如水下尾不再可选），
   * 剪枝会跟着一起变，而 `buckets.inbox` 会静默继续放行——那正是幽灵 id 回来的方式。
   */
  const selectableIds = selectionMode ? new Set([...floatingInbox, ...sunkenInbox].map((task) => task.id)) : null;
  /**
   * 跟着数据回流剪枝 `selectedIds`。
   *
   * `selectedIds` 只存 id，而 `useLiveQuery` 回流不会通知它：悬停删掉一行、或在多选态里勾完成一行
   *（复选框在多选态下仍是「完成」，design 拍板），那行就离开了收件箱，而 id 还攥在手上——
   * 操作栏说「已选 2 条」屏幕上却只剩 1 行高亮，提交时 `db.tasks.get(ghostId)` 拿不到人、
   * 抛的还是裸 `Error` 落进兜底文案，而失败刻意不退出多选，用户原地重试、每次都失败。
   *
   * 剪掉的不是「已完成任务不能当成员」——它可以（design §投影规则 4 的 `doneCount` 就是数它）。
   * 剪掉的是「用户没在看的东西别替他提交」。
   *
   * 无依赖数组（每次渲染跑一趟）而不是依赖 `selectableIds`：那个 Set 每次渲染都是新引用，
   * 写进依赖数组也是每渲染必跑，只是多骗一层。真正防死循环的是下面 updater 里的「没少东西就还它原来那个」。
   */
  useEffect(() => {
    if (selectableIds === null) return;
    setSelectedIds((prev) => {
      let pruned = false;
      for (const id of prev) {
        if (!selectableIds.has(id)) {
          pruned = true;
          break;
        }
      }
      // 无条件 `new Set(...)` 会每次都换引用 → 渲染 → setState → 渲染，死循环。
      if (!pruned) return prev;
      return new Set([...prev].filter((id) => selectableIds.has(id)));
    });
  });
  // 这个 effect 必须待在 exitSelection **之后**：依赖数组在渲染期就读它，
  // 挪回上面那堆 useEffect 里会撞 const 的 TDZ（ReferenceError，整页白屏）。
  useEffect(() => {
    if (!selectionMode) return;
    // 挂 window 而不是 document：测试派发键盘事件走的是 window.dispatchEvent，
    // 而 window 上派发的事件不会向下冒泡到 document——挂错了这条闸在测试里永远不触发。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 有 modal 开着就让位。`Sheet` 与 `TaskDetailSheet` 的 Esc handler 同样挂在 window 上、
      // 与这条互不知情：这条在 selectionMode 转 true 时先注册、它们在弹窗打开时后注册，
      // 同一次 keydown 两个都会跑——用户想关弹窗，选了半天的那批一起没了，
      // 而退出后的页面和「成功建组」长得一模一样（操作栏消失、记录框回来），只少一条 toast。
      //
      // 判据用 DOM 在场而不是给 useConfirm 加 isOpen：待办页上能与多选同屏的弹窗不止确认框
      //（`?taskId=` 深链会在多选态里推开 TaskDetailSheet，它有自己的第三个 window handler），
      // 按 hook 逐个开洞会漏，按 `[role="dialog"]` 一次管住全部。
      if (document.querySelector('[role="dialog"]') !== null) return;
      exitSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode, exitSelection]);

  const rowHandlers = {
    onToggle: toggle,
    onEdit: openDetail,
    onDelete: remove,
    onToToday: moveToToday,
    onToInbox: moveToInbox,
    onToHand: grabToHand,
    onTagsChange: changeTags,
    onCopyTitle: () => showActionToast({ message: "已复制" }),
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
  const projectFilter = useMemo(
    () => ({ searchQuery: composerText, includeTags, excludeTags, tagMode }),
    [composerText, includeTags, excludeTags, tagMode],
  );
  const f = (list: Task[]) => filterTasks(list, projectFilter);
  const filterActive = composerText.trim() !== "" || includeTags.length > 0 || excludeTags.length > 0;
  // 乐观重排的显示序：拖拽落库前先按新序渲染（放手即落位，无回弹硬跳两段视觉）。
  // 必须与 handleDragEnd 的 containerTasks 同源（同一 buckets 派生 + 同 filter），否则下标对不上。
  // 手头区只重排 pending 段：done 行不参与排序，保持各自原序（AtHandSection 只 filter 展示）。
  const displayAtHand =
    optimisticOrder?.containerId === "hand"
      ? [
          ...applyOptimisticOrder(buckets.atHand.filter((t) => !t.done), optimisticOrder.orderedIds),
          ...buckets.atHand.filter((t) => t.done),
        ]
      : buckets.atHand;
  const displayToday =
    optimisticOrder?.containerId === "pool:today"
      ? applyOptimisticOrder(f(buckets.today), optimisticOrder.orderedIds)
      : f(buckets.today);

  const filteredProjects = useMemo(() => {
    if (!filterActive) return buckets.projects;
    return buckets.projects
      .map((group) => ({
        ...group,
        tasks: filterTasks(group.tasks, projectFilter),
      }))
      .filter((group) => group.tasks.length > 0);
  }, [buckets.projects, filterActive, projectFilter]);

  // —— 顶层 DnD：单一 DndContext 包住整页，可拖区只有 today/inbox ——
  const { toast: actionToast, showToast: showActionToast, clearToast: clearActionToast } = useActionToast();
  const createTaskInsideProject = async (goalId: string, title: string): Promise<Task> => {
    try {
      const created = await createTaskForProject(goalId, { title, now: gravityNow });
      if (filterActive && f([created]).length === 0) {
        showActionToast({ message: "任务已创建，但当前筛选未显示它" });
      }
      return created;
    } catch (error) {
      if (error instanceof ProjectAssignError) {
        showActionToast({ message: error.message });
        throw error;
      }
      console.error("[todo] 项目内创建失败:", error);
      const message = "项目内创建失败，稍后再试";
      showActionToast({ message });
      throw new Error(message);
    }
  };
  const renameProject = async (goalId: string, title: string): Promise<void> => {
    try {
      await updateGoal(goalId, { title, now: gravityNow });
    } catch (error) {
      console.error("[todo] 项目改名失败:", error);
      const message = "项目改名失败，稍后再试";
      showActionToast({ message });
      throw new Error(message);
    }
  };
  // 归入项目前的一次性询问（拖走带前置边的任务会连带删边）。useConfirm 是单槽，
  // 但这里只在一次 drag end 的末尾调用，不会有第二个请求来顶替它。
  const { confirm, dialog: confirmDialog } = useConfirm();
  // 当前被拖的任务：项目组按它画「可落 / 不可落」两态。存 id 而不是整行，
  // 免得 useLiveQuery 刷新后手里攥着一份过期的行。allTasks 已含项目区成员，不另开查询（design §数据源）。
  const [dragCandidateId, setDragCandidateId] = useState<string | null>(null);
  // 被拖项所在的 dnd 容器 id。单独记一份是因为子任务查不到行（见下方判定注释）。
  const [dragCandidateContainerId, setDragCandidateContainerId] = useState<string | null>(null);
  // 投递坞的左缘锚点:拖起时量来源区块([data-section])的左缘,坞贴着它出现(理由见 TodoDragDockProps)。
  const [dockAnchorLeftPx, setDockAnchorLeftPx] = useState<number | null>(null);
  // 拖拽中的这条能不能落进项目组。**判定必须在页面做**：组件手上只有 TodoProjectGroup，
  // 既没有 goal.status/kind（判不了 inactive），也没有 members 数组长度（判不了满员）。
  // 更要命的是子任务——listTasks 把 parentId !== null 的行整个跳过，它不在任何 bucket 里，
  // 所以 allTasks 查不到它，只能从 dnd 容器 id 认（`parent:` 前缀即子任务）。
  const dragDropBlocked: boolean | null = (() => {
    if (dragCandidateId === null) return null;
    if (parseTodoContainerId(dragCandidateContainerId)?.kind === "parent") return true;
    const task = allTasks.find((t) => t.id === dragCandidateId);
    // 查不到就当可落：满员与目标组失效本来就由写入侧兜，宁可假高亮也不假禁止。
    return task ? projectAssignBlock(task, 0) !== null : false;
  })();
  /**
   * 被拖子任务的父是否在手头。坞的判定层（`todoDockTargets`）只拿得到 `parent:<父id>` 这个
   * 容器 id 字符串——收件箱子任务与手头子任务在这一层完全同形，分不出父在不在手头。
   * 这里能查 `buckets.atHand` 才分得出来，算好了传给 `TodoDragDock`。
   * 手头区整个区都不出坞（父行本就不出，见 `todoDockTargets` 对 `hand` 源恒返回 `[]`）：
   * 子任务跟着一致——移出手头走 × 按钮，子任务要拿出来就往手头区空白处拖（升根站到手头）。
   * 收件箱子任务的父不在 `buckets.atHand` 里，这里恒 false，坞行为不变。
   */
  const dragCandidateParentInHand: boolean = (() => {
    const container = parseTodoContainerId(dragCandidateContainerId);
    if (container?.kind !== "parent") return false;
    return buckets.atHand.some((t) => t.id === container.parentId);
  })();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent): void {
    hapticGrab();
    const activeContainerId = (event.active.data.current as { containerId?: string } | undefined)?.containerId ?? "";
    const base: TodoIndentLevel = parseTodoContainerId(activeContainerId)?.kind === "parent" ? "child" : "root";
    indentBaseRef.current = base;
    laneRef.current = base;
    keyboardDragRef.current = event.activatorEvent instanceof KeyboardEvent;
    setDockEngaged(false);
    setIndentTargetId(null);
    setDragging(true);
    setDragCandidateId(String(event.active.id));
    setDragCandidateContainerId(activeContainerId);
    // jsdom / 异常路径量不到就退回 null(坞落视口右缘),不挡拖拽本身。
    const activator = event.activatorEvent?.target;
    const sourceSection = activator instanceof Element ? activator.closest("[data-section]") : null;
    setDockAnchorLeftPx(sourceSection ? Math.round(sourceSection.getBoundingClientRect().left) : null);
    // PointerEvent 是 MouseEvent 的子类,故一条 instanceof 同时兜住鼠标与指针事件;触摸取首指。
    const activatorEvent = event.activatorEvent;
    const touch =
      typeof TouchEvent !== "undefined" && activatorEvent instanceof TouchEvent ? activatorEvent.touches[0] : null;
    dragStartPointRef.current =
      activatorEvent instanceof MouseEvent
        ? { x: activatorEvent.clientX, y: activatorEvent.clientY }
        : touch
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    // 起手即当下位置,位移为 0：第一个 pointermove 到达前车道判定也拿得到坐标(否则那一帧退回 previous)。
    pointerPosRef.current = dragStartPointRef.current;
  }

  // 车道判定的唯一驱动点。几何全在 resolveTodoDragLaneAtPointer 里(可测),这里只取值、写回。
  const syncLaneFromPointer = useCallback(() => {
    const lane = resolveTodoDragLaneAtPointer({
      pointer: pointerPosRef.current,
      startPoint: dragStartPointRef.current,
      // 坞垂直居中、高度随药丸数量变:横向带宽算得出,纵向范围只能量。
      dockRect: dockElRef.current?.getBoundingClientRect() ?? null,
      dockAnchored: dockAnchorLeftPx !== null,
      previous: laneRef.current,
      base: indentBaseRef.current,
      keyboard: keyboardDragRef.current,
    });
    laneRef.current = lane;
    setDockEngaged(lane === "dock");
    // 缩进高亮只在 handleDragOver 里重算,而它只在 over 变化时触发:右移亮起高亮后不纵移、
    // 直接左拉出坞,高亮会一直挂着与坞同屏——两个互相矛盾的落点承诺。换出 child 档就清掉。
    // (同值 setState 被 React bailout,不产生逐帧渲染。)
    if (lane !== "child") setIndentTargetId(null);
  }, [dockAnchorLeftPx]);

  // 车道判定挂**原生指针事件**,不挂 dnd-kit 的 onDragMove:后者只在 event.delta 变化时才发,
  // 而 delta 过了 modifiers——clampTodoIndentPreview 把根任务的 x 钳死在 0,纯水平左拉时它一动不动,
  // 事件根本不来(何况那个值本身也判不出出坞位移,见 resolveTodoDragLaneAtPointer)。
  // 键盘拖拽无指针事件,守卫在纯函数里(恒基线档),这里不特判也不会误动。
  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      pointerPosRef.current = { x: event.clientX, y: event.clientY };
      syncLaneFromPointer();
    };
    // touchmove 是老 WebView 的退路(不发 pointer 事件时);两条写同一份 ref,重复更新无副作用。
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      pointerPosRef.current = { x: touch.clientX, y: touch.clientY };
      syncLaneFromPointer();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [dragging, syncLaneFromPointer]);

  function targetContainerFromOver(overContainerId: string, rootAboveId: string | null): TodoContainer | null {
    const container = parseTodoContainerId(overContainerId);
    // 池容器、项目组容器与手头区容器都是直接落点；parent 容器不是（它要按下面的根行反查它所在的池）。
    if (container?.kind === "pool" || container?.kind === "project" || container?.kind === "hand") return container;
    if (!rootAboveId) return null;
    if (buckets.today.some((task) => task.id === rootAboveId)) return { kind: "pool", pool: "today" };
    if (floatingInbox.some((task) => task.id === rootAboveId)) return { kind: "pool", pool: "inbox" };
    return null;
  }

  function handleDragOver(event: DragOverEvent): void {
    const { active, over } = event;
    if (!over || laneRef.current !== "child") {
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
    setDragCandidateContainerId(null);
    setDockEngaged(false);
    const endLane = laneRef.current;
    const indentLevel: TodoIndentLevel = laneToIndentLevel(endLane);
    laneRef.current = "root";
    pointerPosRef.current = null;
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

    // 投递坞落点优先于页内容器判定。helper 消化坞独有路径(手头投递、invalid 拒绝 toast)——
    // 依赖注入使这段可被单测钉住(终审 mutation 实测:不提炼则整段接线删掉测试照样绿);
    // 折算出的 op 走下方 switch,与拖到池容器/项目卡同一条路。overContainerId 与 overId
    // 同值(坞 droppable 的 data.containerId 就是它的 id),取 || 只是防 data 缺失。
    //
    // 先同步解析 dock 落点再决定是否 await:not-dock(页面内拖拽的绝大多数)若也走
    // await applyTodoDockDrop,会让出微任务、乐观重排晚一帧渲染,与 dnd-kit 放手动画
    // 错帧——表现为"放手瞬间卡顿"。纯判定无副作用,同步做完;只有真命中坞才 await 副作用。
    const dockResolution = resolveTodoDockDrop({
      dockId: overContainerId || overId,
      activeContainerId,
      activeParentId,
    });
    // 末道闸:over 指着坞、结束时却已不在 dock 档 = dnd-kit 的 over 账本比车道滞后一拍
    //(它只在指针移动时重算)。用户此刻看到的是坞正在收起,按放弃处理,不替他投一次。
    if (dockResolution.kind !== "not-dock" && endLane !== "dock") return;
    const dockOutcome =
      dockResolution.kind === "not-dock"
        ? null
        : await applyTodoDockDrop(
            {
              grabToHand: grabTaskToHand,
              showToast: (message) => showActionToast({ message }),
              subtaskBlockMessage: (goalTitle) => projectAssignBlockMessage("subtask", goalTitle),
              findGoalTitle: (goalId) => buckets.projects.find((g) => g.goalId === goalId)?.goalTitle ?? null,
            },
            { dockId: overContainerId || overId, activeContainerId, activeParentId, activeId },
          );
    if (dockOutcome === "handled") return;

    const rootAboveId = hoveredRootIdFromOver(overContainerId, overId, activeContainerId);
    const targetContainer = targetContainerFromOver(overContainerId, rootAboveId);
    const activeHasChildren = rootIdsWithChildren.has(activeId);

    const op =
      dockOutcome ??
      resolveTodoDragWithIndent({
        activeContainerId,
        activeParentId,
        activeId,
        activeHasChildren,
        indentLevel,
        rootAboveId,
        targetContainer,
      });

    if (!op) {
      // 落点是项目组却解析不出操作 = 准入拒绝。当前唯一可达的是子任务这一支
      //（重复模板在已排期区、那区不可拖；occurrence 走 assign-to-project 分支由写入侧拒）。
      // 不在这里报，用户就只看到「往这儿拖没反应」——design §动作二 明写四种拒绝都要给原因。
      //
      // 判据只能看容器 id：`activeParentId` 在**本调用点恒为 null**——它查的两个来源
      //（buckets.today/inbox 与 allTasks）全是 listTasks 的产物，而 listTasks 主循环第一行就
      // `if ((t.parentId ?? null) !== null) continue;`。所以这里不再 `|| activeParentId !== null`：
      // 那一支恒 false，是永假的闸而不是防御。（`todoDnd` 里那条同名用例守的是**纯函数的入参契约**
      // ——纯函数可以被喂任意 activeParentId；那说的不是本调用点可达。）
      const activeIsSubtask = parseTodoContainerId(activeContainerId)?.kind === "parent";
      if (targetContainer?.kind === "project" && activeIsSubtask) {
        const group = buckets.projects.find((g) => g.goalId === targetContainer.goalId);
        if (group) showActionToast({ message: projectAssignBlockMessage("subtask", group.goalTitle) });
      }
      return;
    }

    // 吸附落位的触感。上面两处 return 已滤掉「拖到空白处松手」(!over) 与「落点无效 / 被拒」(!op)，
    // 剩下唯一没真移动的情形是把行丢回自己那一格：同容器内 id 唯一，故下面 reorder 分支的
    // oldIndex===newIndex 与这里的 activeId===overId 是同一件事（原地放下不震）。
    // 放在 await 之前：震感要跟着手指落下的那一刻，不是跟着落库回来的那一刻。
    if (activeId !== overId) hapticDrop();

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
                : op.containerId === "hand"
                  // 必须与 AtHandSection 的 pending 渲染序同源（同一 buckets.atHand、同 filter 保序），
                  // arrayMove 下标才对得上渲染序；改了渲染排序必须同步改这里。
                  ? buckets.atHand.filter((t) => !t.done)
                  : [];
          if (containerTasks.length === 0) return;
          const ids = containerTasks.map((t) => t.id);
          const oldIndex = ids.indexOf(activeId);
          const newIndex = ids.indexOf(overId);
          if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
          const ordered = arrayMove(ids, oldIndex, newIndex);
          // 乐观：先同步落地渲染序，dnd-kit 归位动画直接作用在新序上（不落库回流的两段式
          //「先弹回原位再硬跳」）；回流收敛在 useEffect([buckets])，失败在这里回滚。
          setOptimisticOrder({ containerId: op.containerId, orderedIds: ordered });
          try {
            await persistTaskOrder(ordered);
          } catch (error) {
            setOptimisticOrder(null);
            console.error("[todo] 重排落库失败:", error);
            showActionToast({ message: "重排保存失败，顺序未变" });
          }
          break;
        }
        case "move-to-parent": {
          try {
            await nestTaskUnderParent(activeId, op.parentId);
            setRevealChildren((prev) => ({ id: op.parentId, nonce: (prev?.nonce ?? 0) + 1 }));
          } catch (error) {
            console.error("[todo] 收纳为子任务失败:", error);
            // 内部错误码不直接弹给用户：目前唯二可达的是 moveTaskToParentInCurrentTransaction
            // 的两条 throw（见 lib/tasks.ts），没有映射的错误码兜底成一句通俗文案。
            const code = error instanceof Error ? error.message : null;
            const message =
              code === "CANNOT_DEMOTE_ROOT_WITH_CHILDREN"
                ? "带子任务的任务不能收纳成子任务"
                : code === "CANNOT_NEST_BEYOND_ONE_LEVEL"
                  ? "只支持一层嵌套，不能收纳到子任务下"
                  : "收纳失败，稍后再试";
            showActionToast({ message });
          }
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
        case "promote-to-hand": {
          // 落位到手头区末尾：与 promote-to-root 的算法同形（取目标容器现有 max+1）。
          const handTasks = buckets.atHand.filter((t) => !t.done);
          const sortOrder = handTasks.length > 0 ? Math.max(...handTasks.map((t) => t.sortOrder)) + 1 : 0;
          try {
            await promoteTaskToHand(activeId, sortOrder);
          } catch (error) {
            console.error("[todo] 升根到手头失败:", error);
            showActionToast({ message: error instanceof Error ? error.message : "抓到手头失败" });
          }
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
            // 摘除必然删掉源组里引用它的 prerequisites 边（星图里画的「甲做完才能做乙」），
            // 这是 GoalSchema superRefine 的硬后果、改不掉。变的是触发门槛：以前「退出项目」
            // 是 goals 页的显式动作，现在待办页手滑一拖就触发，且成功不展开组、当场察觉不到。
            const loss = await prerequisiteLossOnAssign(activeId, op.goalId);
            if (loss !== null) {
              // 分两句说而不是一句套模板：`count` 是全部源组之和、`goalTitle` 只是边最多的那一组，
              // 多组时凑一句就成了「在「X」里有 N 条」——用户去 X 里数出来比 N 少，
              // 一次数不对就再也不信这个提示，往后一路无脑点「仍要移动」。多组时干脆不点名。
              const body =
                loss.groupCount > 1
                  ? `这条任务在 ${loss.groupCount} 个原项目里共有 ${loss.count} 条前置依赖关系。移到别的项目会一并删除，且无法撤销。`
                  : `这条任务在「${loss.goalTitle}」里有 ${loss.count} 条前置依赖关系。移到别的项目会一并删除，且无法撤销。`;
              const ok = await confirm({
                title: "移动会删掉依赖关系",
                body,
                confirmLabel: "仍要移动",
                danger: true,
              });
              if (!ok) return;
            }
            await assignTaskToProject(op.goalId, activeId);
            const group = buckets.projects.find((g) => g.goalId === op.goalId);
            // 组间排序键是成员的 max(updatedAt)，而归入刚好刷新它——目标组会跳到项目区第一位。
            // 「不展开组」挡不住这种布局变化，所以必须说出它去了哪儿，否则连续拖第二条会照着
            // 旧的视觉位置落进别的组，而且几乎不可见（组不展开、任务同时从收件箱消失）。
            showActionToast({ message: `已归入「${group?.goalTitle ?? "项目"}」` });
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
            // 文案不指认目标组：真正 parse 不过的常常是任务**当前所在**的源组
            //（摘除那步 removeGoalMember 内部的 GoalSchema.parse 会抛），说「这个项目」会让用户
            // 换 C 组 D 组反复重试，每次都在指责一个健康的组。
            showActionToast({ message: "这条任务或它原来所在的项目数据有问题，暂时移不过去" });
          }
          break;
        }
      }
    } catch (err) {
      void err;
    }
  }

  // 项目区在激活标签/搜索筛选（filterActive）时透传 f() 过滤组内任务并自动展开匹配组。
  // 「放进…」的候选：项目区当前显示的组即可，与用户看到的一致。
  const selectableProjects = buckets.projects.map((group) => ({
    goalId: group.goalId,
    goalTitle: group.goalTitle,
  }));
  const projectsBlock = (
    <TodoProjectSection
      groups={filteredProjects}
      filterActive={filterActive}
      hasActiveProjects={buckets.projects.length > 0}
      projectTints={buckets.projectTints}
      handSessionId={buckets.handSession?.id ?? null}
      now={gravityNow}
      revealGoals={revealGoals}
      onRevealConsumed={consumeReveal}
      onExitProject={exitProject}
      onCreateTask={createTaskInsideProject}
      onRenameGoal={renameProject}
      onOpenGoal={(goalId) => navigate(`/goals/${goalId}`)}
      dropBlocked={dragDropBlocked}
      {...rowHandlers}
    />
  );

  const atHandBlock = (
    <AtHandSection
      atHand={displayAtHand}
      session={buckets.handSession}
      resumable={resumable}
      onRelease={releaseFromHand}
      onEndSession={endHand}
      onResume={resumeHand}
      onToggle={toggle}
      onEdit={openDetail}
      onCopyTitle={rowHandlers.onCopyTitle}
      goalLinkedIds={goalLinkedIds}
      metaChip={projectMetaChip}
      onUpdateNote={(note) => {
        const sessionId = buckets.handSession?.id;
        if (sessionId) updateSessionNote(sessionId, note).catch((error) => console.error("场便签保存失败", error));
      }}
      pendingTotal={buckets.atHandPendingTotal}
      indentTargetId={indentTargetId}
      revealChildren={revealChildren}
    />
  );

  const todayBlock = (
    <TaskColumn
      title="今天"
      pool="today"
      tasks={displayToday}
      emptyText="今天没有任务"
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
      {...selectionProps}
      {...rowHandlers}
    />
  );

  const inboxFiltered = f(floatingInbox);
  const sunkenFiltered = f(sunkenInbox);
  const sunkenExtraAction = makeSunkenExtraAction(bumpWeight);
  const inboxBlock = (
    <section data-section="inbox">
      <CollapsibleSection
        title="收件箱"
        count={inboxFiltered.length}
        defaultOpen={inboxOpen}
        onToggle={(open) => {
          // 两处都要写：state 让 React 手上的值跟 DOM 一致（否则程序化展开会被 diff 判成"没变"），
          // localStorage 负责跨会话记住。见 `inboxOpen` 的声明处。
          setInboxOpen(open);
          setInboxCollapsed(!open);
        }}
        action={
          selectionMode ? null : (
            <button
              type="button"
              aria-label="圈成项目"
              onClick={enterSelection}
              className="rounded-ctl px-1.5 py-0.5 td-text-caption text-ink-3 hover:bg-surface-hover hover:text-accent"
            >
              圈成项目
            </button>
          )
        }
      >
        {inboxFiltered.length === 0 && sunkenFiltered.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center td-text-body text-ink-3">收件箱为空</p>
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
                {...selectionProps}
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
                {...selectionProps}
                {...rowHandlers}
              />
            )}
          />
        )}
      </CollapsibleSection>
    </section>
  );

  /**
   * 多选态下把非收件箱区块整块挡掉。用 `inert` 而不是 `pointer-events-none`：
   * 后者只挡指针，Tab 键照样能聚焦进去、回车照样开详情——那正是多选中最容易误触的路径。
   * React 19 原生支持布尔 inert 属性。
   */
  const dimWhenSelecting = (node: ReactNode) => (
    // **包装层恒定存在，进出多选只切 `inert` 与 className，绝不切元素类型。**
    // 换类型（`node` ↔ `<div>{node}</div>`）会让 React 在这个插槽上卸载重挂整棵子树，
    // 而 `TodoProjectSection` 的组展开态 `overrides` 是组件本地 state——每次进/出多选全部清空。
    // 建组成功时最刺眼：新组按 reveal 展开并滚过去，用户此前展开的其余组同时全塌，
    // 「展开新组」的反馈被那阵布局跳动淹掉。
    //
    // `empty:hidden` 不是装饰：空区块（没有已完成任务时 `completedBlock` 就是 `false`；
    // `TodoProjectSection` 无组时 render 出 null）恒定包一层就会在 `flex flex-col gap-4` 里
    // 白占一个 flex 子项、凭空多 16px。`:empty` 靠的是「这层里一个节点都没有」——
    // 往里塞任何占位内容（哪怕一段空白文本）间距就会静默回来。
    <div inert={selectionMode} className={`empty:hidden${selectionMode ? " opacity-40 transition-opacity" : ""}`}>
      {node}
    </div>
  );

  /**
   * 归入前的一次性询问：摘除必然删掉源组里引用这批任务的 prerequisites 边
   *（`GoalSchema` superRefine 的硬后果，见 `prerequisiteLossOnAssignMany`）。
   * 返回 false = 用户取消，调用方必须原地返回、一个字都别写。
   *
   * **可达性（2026-07-26 订正，上一版注释已过时）**：归属轴排他的判据与 `prerequisiteLossOnAssignMany`
   * 取源组的判据逐字相同（`status === "active" && kind === "project"`），而 `selectedIds` 现在会跟着
   * 收件箱剪枝——两条一叠，"选中项带 project 归属"在常规时序下**不可能成立**，这里恒返回 true。
   * 上一版注释说的「另一端 sync 下来就撞上」那条路，正是被剪枝堵死的那条。
   *
   * 仍然保留，因为剩下一个真窗口：远端 goal 行**已经落进 Dexie**、而 liveQuery 通知与剪枝 effect
   * 还没跑完，用户恰在这几毫秒里松手提交。此时 `selectedIds` 还是旧的，而 `prerequisiteLossOnAssignMany`
   * 读的是最新库——确认框会弹，且该弹：那个窗口里不问就是静默丢边。将来若有人改窄剪枝口径
   *（比如水下尾不再可选），这条路还会整个活过来。
   *
   * **承重在数据层**（`goals.test.ts` 的 `prerequisiteLossOnAssignMany` 一节）。页面这一段测不了——
   * 要精确卡在"库已写、effect 未跑"之间，jsdom 里 `act()` 会把渲染和 effect 一口气跑完。
   * 实测：把这两行调用整个删掉，`TodoPage.test.tsx` 一条都不红。别据此当死代码删。
   *
   * `nextGoalId` 传 `goalId` 而不是 `null`：剪枝之后"重入已在的目标组"同样不可达，两者已无实际差异，
   * 但传 `goalId` 才是这个参数的本义（别把目标组自己算成损失），照本义写。
   */
  const confirmPrerequisiteLoss = async (taskIds: string[], nextGoalId: string | null): Promise<boolean> => {
    const loss = await prerequisiteLossOnAssignMany(taskIds, nextGoalId);
    if (loss === null) return true;
    // 分两句说而不是一句套模板：`count` 是全部源组之和、`goalTitle` 只是边最多的那一组，
    // 多组时凑一句就成了「在「X」里有 N 条」——用户去 X 里数出来比 N 少，一次数不对就再也不信这个提示。
    const body =
      loss.groupCount > 1
        ? `这些任务在 ${loss.groupCount} 个原项目里共有 ${loss.count} 条前置依赖关系。移到别的项目会一并删除，且无法撤销。`
        : `这些任务在「${loss.goalTitle}」里有 ${loss.count} 条前置依赖关系。移到别的项目会一并删除，且无法撤销。`;
    return confirm({ title: "移动会删掉依赖关系", body, confirmLabel: "仍要移动", danger: true });
  };

  /**
   * 提交失败的统一出口。可预期的拒绝（准入 / 满员 / 目标组失效）说原因；其余兜底。
   * **两种情况都不退出多选**：选了半天的那批还在手上，退出等于让用户重选一遍，
   * 而且退出后页面看着和成功一模一样——用户会以为进去了。
   */
  const reportSubmitFailure = (error: unknown, fallback: string): void => {
    if (error instanceof ProjectAssignError) {
      showActionToast({ message: error.message });
      return;
    }
    // 用户可达且会永远复现的一类：目标组或源组的裸行过不了 GoalSchema.parse
    //（members 有重复 ref / prerequisites 有悬空边，跨设备并发与 force-push 都能造出来）。静默吞掉等于"应用坏了"。
    console.error("[todo] 多选提交失败:", error);
    showActionToast({ message: fallback });
  };

  /**
   * 提交在途闸，两条提交路径共用。
   *
   * 挡的是**异步提交全程**（含前面那次 `prerequisiteLossOnAssignMany` 的全表读与确认框），
   * 不只是写库那一下。`disabled={!canCreate}` 挡不住：它只看有没有选中 + 有没有名字，提交期间
   * 两者都还成立。最容易撞上的也不是鼠标双击，是在项目名输入框里**按住回车**——`onKeyDown` 对
   * 每一次 keydown（含系统自动重复，约 30ms 一发）都调一次 `submitCreate()`。后果是两个同名
   * goal，第二个的 `assignTasksToProject` 把成员从第一个摘走，留下一个成员为 0 的空壳项目
   * 加一条推给别的设备的 goals create 同步日志。
   *
   * 用 ref 不用 state：state 要等一次渲染才生效，同一个 tick 里连发的第二发读到的还是旧值。
   * 放开必须在 `finally`：失败刻意不退出多选就是为了让用户原地重试，闸漏了就永远点不动。
   */
  const submitPendingRef = useRef(false);
  const runExclusiveSubmit = async (submit: () => Promise<void>): Promise<void> => {
    if (submitPendingRef.current) return;
    submitPendingRef.current = true;
    try {
      await submit();
    } finally {
      submitPendingRef.current = false;
    }
  };

  const submitCreateProject = (title: string): Promise<void> =>
    runExclusiveSubmit(async () => {
      // 快照必须在 exitSelection 之前取：那个函数会把 selectedIds 清空，
      // 成功分支里再去读它只会拿到 0 条，提示语当场说谎。
      const taskIds = [...selectedIds];
      if (taskIds.length === 0) return;
      try {
        // 询问必须**在 try 之内**：它第一句就是 `db.goals.toArray()`（见 prerequisiteLossOnAssignMany），
        // DatabaseClosed / 版本升级期会 reject，而调用点是 `void submitCreateProject(...)`——
        // 留在外面既不进 reportSubmitFailure 也没人接这个 rejection，用户只看到「点了没反应」。
        // 用户点「取消」是 false 不是异常，照旧在这里原地返回，不会被下面的兜底 toast 当成错误。
        if (!(await confirmPrerequisiteLoss(taskIds, null))) return;
        const goal = await createProjectWithMembers({ title, taskIds });
        exitSelection();
        // 建组要展开：刚命名完的组出现在项目区第一位，展开才能当场确认「都进去了」。
        // 与 P3「拖入不展开」不冲突——那条防的是连续拖入让下一个落点跑掉，一次性动作不适用。
        // `openProject` 就是 P2 那套 revealGoals 机制，展开 + scrollIntoView 都在里面，不必另写滚动。
        openProject(goal.id);
        showActionToast({ message: `已建「${goal.title}」· ${taskIds.length} 条` });
      } catch (error) {
        reportSubmitFailure(error, "这些任务或它们原来所在的项目数据有问题，暂时建不了组");
      }
    });

  const submitAssignToProject = (goalId: string): Promise<void> =>
    runExclusiveSubmit(async () => {
      const taskIds = [...selectedIds];
      if (taskIds.length === 0) return;
      try {
        // 同 submitCreateProject：询问在 try 之内，理由见那处注释。
        if (!(await confirmPrerequisiteLoss(taskIds, goalId))) return;
        const goal = await assignTasksToProject(goalId, taskIds);
        exitSelection();
        openProject(goalId);
        showActionToast({ message: `已归入「${goal.title}」· ${taskIds.length} 条` });
      } catch (error) {
        reportSubmitFailure(error, "这些任务或它们原来所在的项目数据有问题，暂时移不过去");
      }
    });

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
        <p className="rounded-card bg-surface px-3 py-6 text-center td-text-body text-ink-3">没有已排期任务</p>
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
      collisionDetection={(args) =>
        preferProjectCollisions({
          pointerHits: pointerWithin(args),
          fallback: () => closestCenter(args),
          // 读 ref 不读 state:车道逐帧同步,state 要多等一次提交才生效——坞的命中资格必须与
          // 手势同拍,否则刚释放/刚进档两个方向都会开出误投与漏接的窗口。
          dockAllowed: laneRef.current === "dock",
        })
      }
      modifiers={[clampTodoIndentPreview]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragCancel={() => {
        setDragging(false);
        setDragCandidateId(null);
        setDragCandidateContainerId(null);
        laneRef.current = "root";
        pointerPosRef.current = null;
        setIndentTargetId(null);
        setDockEngaged(false);
      }}
    >
      <div className={`min-h-full bg-page text-ink${dragging ? " todo-dnd-dragging" : ""}`}>
        <div
          // 顶部间距走 --page-top-gap-lg（原 py-4 的上半，下半从来就被 pad-bottom 覆盖）：有系统安全区
          // 时归零，避免与安全区自带的呼吸位叠成刘海下方那条空带；桌面 / 无刘海设备上仍是 16px。
          className="mx-auto w-full max-w-2xl px-4 [padding-top:var(--page-top-gap-lg)] lg:max-w-none [padding-bottom:var(--pad-bottom)]"
          // 兜底类 [padding-bottom:var(--pad-bottom)]：env() 未定义环境（Firefox 桌面 / 旧 WebView）里
          // calc 整条失效、内联 padding 被丢弃，由它还原批次前的纯数值 contentBottomPaddingPx。
          style={
            {
              "--pad-bottom": `${contentBottomPaddingPx}px`,
              paddingBottom: `calc(${contentBottomPaddingPx}px + var(--safe-bottom))`,
            } as CSSProperties
          }
        >
          {wide ? (
            <ResizableSplit
              className="items-start gap-y-4"
              left={
                <>
                  {dimWhenSelecting(atHandBlock)}
                  {dimWhenSelecting(todayBlock)}
                  {gravityReviewBlock}
                  {dimWhenSelecting(completedBlock)}
                </>
              }
              right={
                <>
                  {dimWhenSelecting(scheduledBlock)}
                  {dimWhenSelecting(projectsBlock)}
                  {inboxBlock}
                </>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {dimWhenSelecting(atHandBlock)}
              {dimWhenSelecting(todayBlock)}
              {gravityReviewBlock}
              {dimWhenSelecting(completedBlock)}
              {dimWhenSelecting(scheduledBlock)}
              {dimWhenSelecting(projectsBlock)}
              {inboxBlock}
            </div>
          )}
        </div>

        {/* 贴着 composer 上沿浮起：composerAvoidancePx = composer 高 + 底部导航高，
            与 DayGroupedList 的 sticky 头同源，保证 toast 不被输入框压住。 */}
        <div
          data-testid="todo-toast-dock"
          className="pointer-events-none fixed inset-x-0 z-[var(--z-backdrop)] px-4 [bottom:var(--bottom-offset)]"
          // 兜底类 [bottom:var(--bottom-offset)]：env() 未定义环境（Firefox 桌面 / 旧 WebView）里 calc
          // 整条失效、内联 bottom 被丢弃，由它还原批次前的纯数值位置（composerAvoidancePx + 8）。
          style={
            {
              "--bottom-offset": `${composerAvoidancePx + 8}px`,
              bottom: `calc(${composerAvoidancePx + 8}px + var(--safe-bottom))`,
            } as CSSProperties
          }
        >
          <div className="pointer-events-auto mx-auto w-full max-w-2xl">
            <ActionToastBar toast={actionToast} onDismiss={clearActionToast} ariaLabel="待办操作反馈" />
          </div>
        </div>

        {/* 多选态下操作栏顶替记录框：两者同一位置、同一层级（见 TodoSelectionBar 的 zIndex 注释）。
            TodoComposer 不渲染时 composerHeightPx 保持上一次测量值，contentBottomPaddingPx 因此不跳动——
            操作栏高度与 composer 相近，沿用旧值即可，不为此加新的测量逻辑。 */}
        {wide && (
          <TodoDragDock
            dragging={dragging}
            dockEngaged={dockEngaged}
            activeContainerId={dragCandidateContainerId}
            projects={selectableProjects}
            dropBlocked={dragDropBlocked}
            anchorLeftPx={dockAnchorLeftPx}
            activeParentInHand={dragCandidateParentInHand}
            containerRef={dockElRef}
          />
        )}

        {selectionMode ? (
          <TodoSelectionBar
            selectedCount={selectedIds.size}
            projects={selectableProjects}
            bottomOffsetPx={fixedBarBottomPx}
            onCreate={(title) => void submitCreateProject(title)}
            onAssign={(goalId) => void submitAssignToProject(goalId)}
            onCancel={exitSelection}
          />
        ) : (
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
            bottomOffsetPx={fixedBarBottomPx}
            hiddenByScroll={composerHiddenByScroll}
            formRef={composerRef}
          />
        )}

        {confirmDialog}

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
