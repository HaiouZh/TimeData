import type { Collision, Modifier } from "@dnd-kit/core";
import type { Task } from "@timedata/shared";

export type TodoPool = "today" | "inbox";

export const TODO_CHILD_INDENT_PX = 28;
export const TODO_INDENT_RELEASE_PX = 12;

export type TodoIndentLevel = "root" | "child";

/**
 * 由横向位移判定缩进层级，**相对于被拖项自身的基线层级 `base`**：
 * - `base="root"`（拖根任务）：静止 = root；向右越过 28px 才降级为 child，滞回到 12px 内回落为 root。
 * - `base="child"`（拖子任务）：静止 = child；向左越过 -28px 才升级为 root，滞回到 -12px 内回落为 child。
 *
 * `deltaX` 是 dnd-kit 的指针水平位移，不是绝对缩进；竖直拖（deltaX≈0）恒保持基线层级，
 * 这保证子任务竖直重排不会被误判成 root（否则会被当成 promote-to-root 拽出父任务）。
 */
export function resolveIndentLevel(
  deltaX: number,
  previous: TodoIndentLevel,
  base: TodoIndentLevel = "root",
): TodoIndentLevel {
  if (base === "child") {
    if (deltaX >= -TODO_INDENT_RELEASE_PX) return "child";
    if (previous === "root") return "root";
    return deltaX <= -TODO_CHILD_INDENT_PX ? "root" : "child";
  }
  if (deltaX <= TODO_INDENT_RELEASE_PX) return "root";
  if (previous === "child") return "child";
  return deltaX >= TODO_CHILD_INDENT_PX ? "child" : "root";
}

/** 拖拽横向车道：在缩进两档（root/child）左侧再加一档 dock（投递坞现身并接投递）。 */
export type TodoDragLane = TodoIndentLevel | "dock";

/** 坞矩形外的保持缓冲：指针在四周这一带内仍算"在坞上"，避免贴边抖动把坞抖没。 */
export const TODO_DOCK_HOLD_BUFFER_PX = 16;

/**
 * 由横向位移判定三档车道，dock 档与缩进档同构叠加：
 * - `base="root"`（拖根任务）：左拉越过 -28 进 dock，回撤到 -12 内释放回 root。
 * - `base="child"`（拖子任务）：-28 先升 root（缩进档既有语义），出坞阈值按基线加深一档到 -56，
 *   释放线随之左移到 -40——升根瞬间绝不同时满足出坞条件，两次越档等距、可分辨。
 * - root/child 之间的判定原样委托 `resolveIndentLevel`，右移语义一字不变。
 * - `keyboard=true`（键盘拖拽）恒返回基线档：跨栏键盘移动本身就是一段很大的横向位移，
 *   不判 sensor 会把键盘重排误判成出坞/换档；恒基线等价于"视作 deltaX=0"。
 * - `holdDock=true` 短路释放：**释放线是相对起手点的位移，而坞画在绝对位置**（来源栏左缘），
 *   两者是两个坐标系。起手点距该左缘近于释放距离时，指针一进坞矩形就已满足释放条件——
 *   坞会在指针够到药丸前自己关掉，坞开着却一个也投不中。调用方按"指针是否落在坞的真实矩形
 *  （四周含缓冲）内"算出 `holdDock`，把"坞开着时指针在坞内永不释放"补成硬保证。
 *   它只短路释放、不短路进档：否则指针恰好扫过坞矩形就会凭空开坞。
 */
export function resolveTodoDragLane(
  deltaX: number,
  previous: TodoDragLane,
  base: TodoIndentLevel = "root",
  keyboard = false,
  holdDock = false,
): TodoDragLane {
  if (keyboard) return base;
  const origin = base === "child" ? -TODO_CHILD_INDENT_PX : 0;
  const engage = origin - TODO_CHILD_INDENT_PX;
  const release = origin - TODO_INDENT_RELEASE_PX;
  if (previous === "dock") {
    if (holdDock || deltaX < release) return "dock";
    return resolveIndentLevel(deltaX, "root", base);
  }
  if (deltaX <= engage) return "dock";
  return resolveIndentLevel(deltaX, previous, base);
}

/** 判 `holdDock` 用的坞矩形（与 DOMRect 结构兼容，测试里可直接给字面量）。 */
export interface TodoDockRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ResolveTodoDragLaneAtPointerInput {
  /** 指针当前视口坐标；量不到（键盘拖拽、拖起后一帧未动）为 null。 */
  pointer: { x: number; y: number } | null;
  /** 拖起瞬间的指针视口坐标；键盘拖拽恒 null。 */
  startPoint: { x: number; y: number } | null;
  /** 坞元素的真实矩形（`getBoundingClientRect()`）；未挂载为 null。 */
  dockRect: TodoDockRect | null;
  /** 坞是否锚到了来源栏左缘；false = 退到视口右缘。 */
  dockAnchored: boolean;
  previous: TodoDragLane;
  base: TodoIndentLevel;
  keyboard: boolean;
}

/**
 * 由**指针真实视口坐标**解出车道——页面接线的唯一入口。
 *
 * **横向位移必须自己算，不能用 dnd-kit `onDragMove` 的 `event.delta`**：那个值是过了
 * `modifiers` 之后的（core.esm.js 2959 `applyModifiers` → 2983 `scrollAdjustedTranslate`
 * → 3229 事件的 `delta`），而 `clampTodoIndentPreview` 把根任务的 x 夹进 `[0,28]`、子任务夹进
 * `[-28,0]`——出坞要的更深负位移在那条通路上**结构性不存在**，坞永远停在细条态，左拉多远都不展开
 * （2026-08-03 真机验收退回项）。缩进档当时没跟着坏纯属边界巧合：modifier 的钳制上限与缩进阈值
 * 同为 `TODO_CHILD_INDENT_PX`，恰好够得着。
 *
 * 同一个理由，`holdDock` 也必须拿真实坐标判，不能按"起手点 + delta"拼装——手拉 200px 而 delta
 * 只报 0，拼出来的"指针位置"根本不是指针在哪，坞矩形判定会整条失效。
 *
 * 另一面：`event.delta` 变了才触发 `onDragMove`，x 被钳死时纯水平左拉根本不发事件。所以调用方
 * 的驱动源也得是指针事件本身，不能挂在 `onDragMove` 上。
 */
export function resolveTodoDragLaneAtPointer({
  pointer,
  startPoint,
  dockRect,
  dockAnchored,
  previous,
  base,
  keyboard,
}: ResolveTodoDragLaneAtPointerInput): TodoDragLane {
  // 键盘拖拽没有指针坐标，判定原样委托给车道函数的键盘守卫（恒基线档）。
  if (keyboard) return resolveTodoDragLane(0, previous, base, true, false);
  if (pointer === null || startPoint === null) return previous;
  const holdDock =
    dockAnchored &&
    dockRect !== null &&
    pointer.x >= dockRect.left - TODO_DOCK_HOLD_BUFFER_PX &&
    pointer.x <= dockRect.right + TODO_DOCK_HOLD_BUFFER_PX &&
    pointer.y >= dockRect.top - TODO_DOCK_HOLD_BUFFER_PX &&
    pointer.y <= dockRect.bottom + TODO_DOCK_HOLD_BUFFER_PX;
  const lane = resolveTodoDragLane(pointer.x - startPoint.x, previous, base, false, holdDock);
  // 量不到锚点时坞退视口右缘，而出坞手势向左——两者方向互斥、指针结构性够不到药丸。
  // 与其让坞开在够不着的地方，不如干脆不进 dock 档（坞至多停在细条态）。
  return lane === "dock" && !dockAnchored ? "root" : lane;
}

/**
 * 车道 → 缩进语义。**dock 档绝不是收纳**：左拉出坞后松手若落在某一行上，按 root 解析
 * （通常是无操作或同容器重排），不能收纳成该行的子任务。
 *
 * 提成纯函数而不是在页面里写三元：这条派生此前只是 `TodoPage` 里的一行，把它合并成
 * `lane !== "root" ? "child" : "root"` 这类似是而非的写法，整套页面测试照绿，而真机上
 * 左拉出坞松手会静默改数据（收纳落库）。落在这里才锁得住。
 */
export function laneToIndentLevel(lane: TodoDragLane): TodoIndentLevel {
  return lane === "child" ? "child" : "root";
}

/**
 * 拖拽预览横向夹取，避免横向滚动条：
 * - 拖根任务：只允许向右缩进，夹到 `[0, 28]`。
 * - 拖子任务：只允许向左升级，夹到 `[-28, 0]`，让"向左拽出父"的手势有跟手的虚影。
 *
 * **它不只影响渲染 transform**：dnd-kit 把 modifier 的输出同时当成事件里的 `delta`
 *（`onDragMove`/`onDragEnd` 都是），所以这里夹掉的位移在整条事件通路上就不存在了。
 * 车道判定因此不读 `delta`，改由 `resolveTodoDragLaneAtPointer` 拿指针真实坐标自己算——
 * 早先那句"落点判定仍用 raw delta.x"是错的，坞左拉现身当场栽在这上面（见该函数注释）。
 */
export const clampTodoIndentPreview: Modifier = ({ transform, active }) => {
  const containerId = (active?.data.current as { containerId?: string } | undefined)?.containerId ?? "";
  const container = parseTodoContainerId(containerId);
  const isChild = container?.kind === "parent";
  const x = isChild
    ? Math.min(0, Math.max(transform.x, -TODO_CHILD_INDENT_PX))
    : Math.max(0, Math.min(transform.x, TODO_CHILD_INDENT_PX));
  return { ...transform, x };
};

/** 拖拽期内联状态 ref 组（页面接线层持有的可变坐标/车道状态）。 */
export interface TodoDragRefs {
  lane: { current: TodoDragLane };
  indentBase: { current: TodoIndentLevel };
  keyboard: { current: boolean };
  dragStartPoint: { current: { x: number; y: number } | null };
  pointerPos: { current: { x: number; y: number } | null };
  /** 被拖行所属的项目组 id（非项目区来源为 null）；喂 preferProjectCollisions 的同组行优先档。 */
  activeProjectGoalId: { current: string | null };
}

/**
 * 拖拽状态 ref 组复位到初始值，**新增字段只改这一处**。
 * 复位必须在 dragEnd 与 dragCancel 两条路径都执行：此前复位逻辑在两处各写一份，
 * 漏改 cancel 路径会静默残留（`laneRef` 非拖拽时仍被碰撞层读取，`7a05f126` 修过的
 * 「行隐身」正是残留车道态）。dragStart 开头也复位一次，清掉异常中断留下的旧值。
 */
export function resetTodoDragRefs(refs: TodoDragRefs): void {
  refs.lane.current = "root";
  refs.indentBase.current = "root";
  refs.keyboard.current = false;
  refs.dragStartPoint.current = null;
  refs.pointerPos.current = null;
  refs.activeProjectGoalId.current = null;
}

/** dnd-kit container id 域：池容器、父任务容器、项目组容器。 */
export type TodoContainer =
  | { kind: "pool"; pool: TodoPool }
  | { kind: "parent"; parentId: string }
  | { kind: "project"; goalId: string }
  | { kind: "hand" };

/** drop 后要执行的语义化操作。 */
export type TodoDragOperation =
  | { kind: "reorder"; containerId: string }
  | { kind: "move-to-parent"; parentId: string }
  | { kind: "promote-to-root"; pool: TodoPool }
  | { kind: "promote-to-hand" }
  | { kind: "promote-to-project"; goalId: string }
  | { kind: "schedule-root"; pool: TodoPool }
  | { kind: "assign-to-project"; goalId: string };

/** 项目组 droppable 的 container id。组件与判定层共用它，避免两处手写前缀漂移。 */
export function projectContainerId(goalId: string): `project:${string}` {
  return `project:${goalId}`;
}

/**
 * 项目区行的 dnd id 前缀。
 *
 * **不能用 `project:<goalId>:<taskId>` 那种形状**：`parseTodoContainerId` 会把它误解析成
 * goalId = `"<goalId>:<taskId>"` 的项目容器，静默拼出一个不存在的组；`preferProjectCollisions`
 * 里的 `startsWith("project:")` 也会把行当成卡片。带 `-row` 的形状对两者都天然不匹配。
 */
export function todoProjectRowIdPrefix(goalId: string): string {
  return `project-row:${goalId}:`;
}

/** 项目区某一行的 dnd id。组件与判定层共用，避免两处手写前缀漂移（同 projectContainerId 的理由）。 */
export function todoProjectRowId(goalId: string, taskId: string): string {
  return `${todoProjectRowIdPrefix(goalId)}${taskId}`;
}

export function todoContainerId(container: TodoContainer): string {
  if (container.kind === "hand") return "hand";
  if (container.kind === "pool") return `pool:${container.pool}`;
  if (container.kind === "parent") return `parent:${container.parentId}`;
  return projectContainerId(container.goalId);
}

/**
 * 解析 container id 字符串。仅接受：
 * - `pool:today` / `pool:inbox`
 * - `parent:<非空 id>`
 * - `project:<非空 goalId>`
 * 其它（含 `parent:` / `project:` 空 id）返回 null。
 */
export function parseTodoContainerId(value: string | null | undefined): TodoContainer | null {
  if (!value) return null;
  if (value === "hand") return { kind: "hand" };
  if (value === "pool:today") return { kind: "pool", pool: "today" };
  if (value === "pool:inbox") return { kind: "pool", pool: "inbox" };
  if (value.startsWith("parent:")) {
    const parentId = value.slice("parent:".length);
    if (!parentId) return null;
    return { kind: "parent", parentId };
  }
  if (value.startsWith("project:")) {
    const goalId = value.slice("project:".length);
    if (!goalId) return null;
    return { kind: "project", goalId };
  }
  return null;
}

/** 投递坞落点域。hand 是坞独有语义;pool/project 复用页内容器语义。 */
export type TodoDockTarget =
  | { kind: "pool"; pool: TodoPool }
  | { kind: "hand" }
  | { kind: "project"; goalId: string };

/** 坞 droppable 的 id。组件与判定层共用,避免前缀漂移(同 projectContainerId 的理由)。 */
export function todoDockId(target: TodoDockTarget): string {
  if (target.kind === "pool") return `dock:pool:${target.pool}`;
  if (target.kind === "hand") return "dock:hand";
  return `dock:project:${target.goalId}`;
}

export function parseTodoDockId(value: string | null | undefined): TodoDockTarget | null {
  if (!value) return null;
  if (value === "dock:pool:today") return { kind: "pool", pool: "today" };
  if (value === "dock:pool:inbox") return { kind: "pool", pool: "inbox" };
  if (value === "dock:hand") return { kind: "hand" };
  if (value.startsWith("dock:project:")) {
    const goalId = value.slice("dock:project:".length);
    if (!goalId) return null;
    return { kind: "project", goalId };
  }
  return null;
}

export type TodoDockDropResolution =
  | { kind: "not-dock" }
  | { kind: "grab-to-hand" }
  | { kind: "op"; op: TodoDragOperation }
  | { kind: "invalid"; target: TodoDockTarget };

/**
 * 坞落点解析:pool/project 折算成对应容器后走 resolveTodoDragOperation(语义与拖到
 * 池容器/项目卡逐字相同);hand 是坞独有分支。reorder 一律拦成 invalid——坞没有位置语义,
 * 且正常不可达(当前池的药丸不渲染),拦住是防隐藏规则漏了时落成怪异重排。
 */
export function resolveTodoDockDrop({
  dockId,
  activeContainerId,
  activeParentId,
}: {
  dockId: string;
  activeContainerId: string;
  activeParentId: string | null;
}): TodoDockDropResolution {
  const target = parseTodoDockId(dockId);
  if (!target) return { kind: "not-dock" };
  // 手头源 / 项目区源都不开放投坞（区内动作专属）：todoDockTargets 已不渲染药丸，
  // 这里是隐藏规则漏了时的兜底。
  const activeKind = parseTodoContainerId(activeContainerId)?.kind;
  if (activeKind === "hand" || activeKind === "project") return { kind: "invalid", target };
  if (target.kind === "hand") {
    // 子任务投手头 = 升根并站到手头（走 promote-to-hand，落库先升根再抓；
    // grabTaskToHand 对子任务的硬拒因此不会被这条路径触发）。
    if (parseTodoContainerId(activeContainerId)?.kind === "parent") {
      return { kind: "op", op: { kind: "promote-to-hand" } };
    }
    return { kind: "grab-to-hand" };
  }
  const container: TodoContainer =
    target.kind === "pool" ? { kind: "pool", pool: target.pool } : { kind: "project", goalId: target.goalId };
  const op = resolveTodoDragOperation({
    activeContainerId,
    targetContainerId: todoContainerId(container),
    activeParentId,
  });
  if (!op || op.kind === "reorder") return { kind: "invalid", target };
  return { kind: "op", op };
}

/**
 * 拖拽中应显示的坞落点(有序:今天/手头/收件箱/项目)。
 * 被拖行所在池的药丸不显示;子任务(parent:)时 today/inbox 都显示(升根语义),
 * 子任务也显示手头药丸——投上去走升根到手头。
 *
 * `activeParentInDocklessZone`：被拖子任务的父是否在一个**整区不出坞**的区里（手头区 / 项目组）。
 * 容器 id 只有 `parent:<父id>` 一种形状，收件箱子任务、手头子任务与项目组内的子任务在这一层
 * 完全同形、判定层本身分不出来——这个参数由调用方（页面，能查手头桶与项目桶）算好了传进来。
 * 默认值 `false` 保证不传时行为一字不变。
 */
export function todoDockTargets(
  activeContainerId: string,
  projects: readonly { goalId: string }[],
  activeParentInDocklessZone = false,
): TodoDockTarget[] {
  const active = parseTodoContainerId(activeContainerId);
  // 手头区只做区内重排，坞不对手头源显示任何药丸。
  if (active?.kind === "hand") return [];
  // 项目区整区同理：本批不做「拖出组」，退出项目走行尾 × 按钮。
  if (active?.kind === "project") return [];
  if (active?.kind === "parent" && activeParentInDocklessZone) return [];
  const targets: TodoDockTarget[] = [];
  if (!(active?.kind === "pool" && active.pool === "today")) targets.push({ kind: "pool", pool: "today" });
  targets.push({ kind: "hand" });
  if (!(active?.kind === "pool" && active.pool === "inbox")) targets.push({ kind: "pool", pool: "inbox" });
  for (const project of projects) targets.push({ kind: "project", goalId: project.goalId });
  return targets;
}

export interface ResolveTodoDragInput {
  /** active draggable 所在的容器 id（必含）。 */
  activeContainerId: string;
  /** drop 目标的容器 id 或对应 sortable item id 之父容器 id。 */
  targetContainerId: string;
  /** 当前 active task 的 parentId（root 为 null）；用于区分升降级语义。 */
  activeParentId: string | null;
  /**
   * 被拖**子任务**的父所在的 active project 组 id；父不属于任何组、或被拖的不是子任务时为 null。
   *
   * 存在的理由只有一个：下面两种情形的容器 id 字符串**逐字相同**，判定层分不出来——
   * ① 收件箱某条任务的子任务拖到项目卡上（跨区的「先升根再入组」复合动作，**仍然拒绝**）；
   * ② 项目组内某成员的子任务往左拖落回本组（升根回组，**本批要开的**）。
   * 区分点是「父属不属于这个组」，只有页面查得到（`buckets.projects`），故由它算好传进来。
   */
  activeParentProjectGoalId?: string | null;
}

/**
 * 给定一次 drag end 的容器对，决定执行哪种待办操作。
 *
 * - 同一容器 → reorder（调用方再根据 sortable item 顺序计算新排序）；`pool:inbox` 例外，返回 null。
 * - child → 池（today/inbox）→ promote-to-root。
 * - root → parent → move-to-parent。
 * - root 在 today/inbox 之间 → schedule-root（schedule 或 unschedule）。
 * - root → 项目组 → assign-to-project（子任务不收，见分支内注释）。
 *
 * 返回 null 表示无效组合（例如目标解析失败、子任务被拖到子任务作为 parent 等），调用方应忽略。
 */
export function resolveTodoDragOperation({
  activeContainerId,
  targetContainerId,
  activeParentId,
  activeParentProjectGoalId = null,
}: ResolveTodoDragInput): TodoDragOperation | null {
  const active = parseTodoContainerId(activeContainerId);
  const target = parseTodoContainerId(targetContainerId);
  if (!active || !target) return null;

  if (activeContainerId === targetContainerId) {
    // 收件箱不支持同容器重排：显示序 = 按 createdAt 分天 + 段内 createdAt 倒序
    //（lib/tasks/inboxGrouping.ts），根本不读 sortOrder，落库后松手照样弹回；
    // 而 persistTaskOrder 会把变化行的 updatedAt 推到当下，等于重置这些行的重力下沉时钟
    //（gravity.isTaskSunken 读 updatedAt），该沉的不沉。故判为无效操作。
    if (target.kind === "pool" && target.pool === "inbox") return null;
    return { kind: "reorder", containerId: activeContainerId };
  }

  // → 项目组：分两支。
  if (target.kind === "project") {
    // 子任务这一支：只有「父就在这个组里」才是升根回组，其余一律拒绝（口径同上方入参注释）。
    if (active.kind === "parent") {
      return activeParentProjectGoalId !== null && activeParentProjectGoalId === target.goalId
        ? { kind: "promote-to-project", goalId: target.goalId }
        : null;
    }
    // 根任务这一支：外区归入，语义一字未变。
    if (active.kind !== "pool" || activeParentId !== null) return null;
    return { kind: "assign-to-project", goalId: target.goalId };
  }

  // 组内收纳：项目区的行 → 同组某行的 parent 容器。
  // **不在这里重复判「那个 parentId 属于哪个组」**：本函数拿不到这份信息，硬加只能写成恒真的假闸。
  // 跨组已被上游 `hoveredRootIdFromOver` 的同组守卫挡掉（它对跨组算不出 rootAboveId，
  // 于是根本拼不出 `parent:<别组的行>`），第二道保险在 `resolveTodoDragWithIndent`。
  if (active.kind === "project" && target.kind === "parent") {
    return { kind: "move-to-parent", parentId: target.parentId };
  }

  // 哨兵：项目容器作 active 的其余组合（→ pool、→ project、→ hand）一律无效。
  // **位置有讲究**：必须排在上面两条 project 分支之后。挪到它们之前会把组内收纳与升根回组
  // 一起短路成死代码，而整套测试照绿（返回值都是 null，行为没变），真机上只表现为
  // 「项目区的行拖了没反应」。
  if (active.kind === "project") return null;

  // hand → parent:X —— 手头行被收纳为 X 的子任务（区内收纳）
  if (active.kind === "hand" && target.kind === "parent") {
    return { kind: "move-to-parent", parentId: target.parentId };
  }

  // parent:X → hand —— 子任务升为根任务并站到手头。落库走 taskNesting.promoteTaskToHand
  //（先升根再抓，grabTaskToHand 对子任务的硬拒因此不会被这条路径触发）。
  if (active.kind === "parent" && target.kind === "hand") {
    // 父在项目组的子任务不走这条：项目区不提供「拖出组」，含它名下的子任务。
    if (activeParentProjectGoalId !== null) return null;
    return { kind: "promote-to-hand" };
  }

  // child → pool：升级为 root（child 不允许把别的 root 拖进来——一层约束）
  if (active.kind === "parent" && target.kind === "pool") {
    // 同 hand 分支的理由：父在项目组的子任务不能经拖拽升根离组。
    if (activeParentProjectGoalId !== null) return null;
    return { kind: "promote-to-root", pool: target.pool };
  }

  // root → parent：降级为 child（最终是否真能降级由 helper 兜底，带 children 会抛错）
  if (active.kind === "pool" && target.kind === "parent") {
    return { kind: "move-to-parent", parentId: target.parentId };
  }

  // root 在 today/inbox 之间：schedule / unschedule（语义合一）
  if (active.kind === "pool" && target.kind === "pool" && activeParentId === null) {
    return { kind: "schedule-root", pool: target.pool };
  }

  // child → 不同 parent：跨父移动，按 move-to-parent 处理
  if (active.kind === "parent" && target.kind === "parent" && active.parentId !== target.parentId) {
    return { kind: "move-to-parent", parentId: target.parentId };
  }

  return null;
}

/**
 * 由一次 drag-over 的目标，反查它归属的 root 任务 id（用于缩进候选父判定）。
 * - 池容器（pool:today/inbox）：over 自身就是根行，root = overTaskId。
 * - parent 容器（parent:<X>）：root = X（无论 over 是子任务行还是落点区）。
 * - hand 容器：**仅当拖拽来源也是 hand 时** root = overTaskId；否则 null。
 * - project 容器：**仅当拖拽来源是同一个 project 组时** root = overTaskId；否则 null。
 * 无法归属（非法/缺失容器、upcoming 等）返回 null。
 *
 * 第二参收的是**任务 id**（调用方从 `over.data.current.taskId` 取），不是 dnd item id——
 * 项目区的行另编了带前缀的 dnd id（同一条任务同屏出现两次会撞 id），两者不再等价。
 *
 * 第三参既是容器解析失败时的兜底，也是「拖拽来源」判据。收纳只在区内 / 组内成立——
 * 外区任务要归到某件活底下，正确路径是先进那个区 / 那个组再收敛。这道守卫必须落在本函数，
 * 因为收纳高亮（handleDragOver）与落库判定共用它；只拦落库会留下「亮了高亮却无事发生」。
 */
export function hoveredRootIdFromOver(
  overContainerId: string,
  overTaskId: string,
  activeContainerId?: string,
): string | null {
  // 投递坞不是缩进落点:dock id 解析不进 TodoContainer,会 fall 到 activeContainerId(通常是池)
  // 把 dock id 字符串当「根行 id」返回,下游拿它拼 parent:<dock:…> 落成垃圾 move-to-parent。
  if (parseTodoDockId(overContainerId) !== null || parseTodoDockId(overTaskId) !== null) return null;
  // 容器级 droppable（项目组卡片）落点没有 taskId。不早退就会把容器 id 当根行 id 返回，
  // 与上面那条坞守卫是同一类事故。
  if (!overTaskId) return null;
  const container = parseTodoContainerId(overContainerId) ?? parseTodoContainerId(activeContainerId);
  if (!container) return null;
  if (container.kind === "project") {
    // hand 是单例容器，比 kind 就够；项目区有 N 个容器，只比 kind 会放行跨组收纳
    // ——拖到隔壁组的行上照样亮高亮、照样落库，而那是一次静默的归属变更。
    const active = parseTodoContainerId(activeContainerId);
    return active?.kind === "project" && active.goalId === container.goalId ? overTaskId : null;
  }
  if (container.kind === "hand") {
    return parseTodoContainerId(activeContainerId)?.kind === "hand" ? overTaskId : null;
  }
  // 走到这里 container 只可能是 pool / parent 两种容器，两种都是组外落点——
  // 项目区来源一律不认：组内两个手势只在组内成立，「拖出组」不由拖拽提供（退出走行内 × 按钮）。
  // 与上面 project / hand 两支的守卫同类——那两支挡的是「外区来源进不来」，这一支挡的是「组内来源出不去」。
  if (parseTodoContainerId(activeContainerId)?.kind === "project") return null;
  if (container.kind === "pool") return overTaskId;
  return container.parentId;
}

/** `resolveTodoDropTarget` 的三个查表回调。页面用闭包实现，测试用假数据实现。 */
export interface TodoDropLookup {
  isTodayRoot: (taskId: string) => boolean;
  isFloatingInboxRoot: (taskId: string) => boolean;
  /** 该任务作为未完成成员属于哪个 active project 组；不属于返回 null。 */
  projectGoalIdOfMember: (taskId: string) => string | null;
}

/**
 * 把 over 的容器 id 解析成落点容器。`parent:` 容器不是直接落点——它要按悬停的那个根行
 * 反查根行所在的池 / 组，故需要三个查表回调。
 *
 * **项目区那一支不能省**：成员被归属轴排他扣出了 inbox 桶，前两个查表都查不到它；
 * 组内子任务往左拖时 over 常落在兄弟子任务上（容器 `parent:<爹>`），不反查就解析不出落点、
 * 松手无事发生（而 over 落在组卡片上时照常工作，表现为同一手势一半灵一半失灵）。
 */
export function resolveTodoDropTarget(
  overContainerId: string,
  rootAboveId: string | null,
  lookup: TodoDropLookup,
): TodoContainer | null {
  const container = parseTodoContainerId(overContainerId);
  if (container?.kind === "pool" || container?.kind === "project" || container?.kind === "hand") return container;
  if (!rootAboveId) return null;
  if (lookup.isTodayRoot(rootAboveId)) return { kind: "pool", pool: "today" };
  if (lookup.isFloatingInboxRoot(rootAboveId)) return { kind: "pool", pool: "inbox" };
  const goalId = lookup.projectGoalIdOfMember(rootAboveId);
  return goalId === null ? null : { kind: "project", goalId };
}

export interface ResolveTodoDragWithIndentInput {
  activeContainerId: string;
  activeParentId: string | null;
  /** 见 `ResolveTodoDragInput` 同名字段；本函数只负责透传给 `resolveTodoDragOperation`。 */
  activeParentProjectGoalId?: string | null;
  activeId: string;
  activeHasChildren: boolean;
  indentLevel: TodoIndentLevel;
  rootAboveId: string | null;
  targetContainer: TodoContainer | null;
}

export function resolveTodoDragWithIndent({
  activeContainerId,
  activeParentId,
  activeParentProjectGoalId = null,
  activeId,
  activeHasChildren,
  indentLevel,
  rootAboveId,
  targetContainer,
}: ResolveTodoDragWithIndentInput): TodoDragOperation | null {
  const activeContainer = parseTodoContainerId(activeContainerId);
  const canBecomeChild =
    indentLevel === "child" &&
    !activeHasChildren &&
    rootAboveId !== null &&
    rootAboveId !== activeId &&
    // 项目组只在**组内**是缩进落点。第二道保险：hoveredRootIdFromOver 的同组守卫已经让跨组
    // 算不出 rootAboveId，但那是调用方传进来的值，斜着拖进隔壁组不该因为一个错传
    // 就变成拆 / 接父子关系。
    (targetContainer?.kind !== "project" ||
      (activeContainer?.kind === "project" && activeContainer.goalId === targetContainer.goalId));
  const targetContainerId = canBecomeChild
    ? `parent:${rootAboveId}`
    : targetContainer
      ? todoContainerId(targetContainer)
      : "";

  return resolveTodoDragOperation({
    activeContainerId,
    targetContainerId,
    activeParentId,
    activeParentProjectGoalId,
  });
}

/** 给一个 task 计算它在拖拽系统中所属的容器 id。 */
export function containerIdForTask(task: Pick<Task, "parentId" | "scheduledAt">, todayDate: string): string {
  if (task.parentId) return `parent:${task.parentId}`;
  if (task.scheduledAt?.startsWith(todayDate)) return "pool:today";
  if (!task.scheduledAt) return "pool:inbox";
  // 已排期到非今天：upcoming，不参与拖拽，调用方应跳过。
  return "";
}

/**
 * 项目组落点优先于最近中心。
 *
 * 页面用 `closestCenter`，它按 droppable 矩形**中心点**算距离；而项目组展开后是几百像素高的大块，
 * 中心离手指很远，会被隔壁收件箱某一行（中心近）抢走落点——整块 droppable 在展开态近乎失灵。
 * 故：指针真的落在某个项目组内时只认它，否则原样退回 closestCenter 的结果。
 * 既有 droppable 全都不是 `project:` 前缀，因此非项目场景行为一字不变。
 *
 * 键盘拖拽没有指针坐标，`pointerWithin` 恒空 → 走 fallback，项目组在纯键盘下仍难命中（已知限制）。
 *
 * **入参是对象不是两个位置参数**：两者同型 `Collision[]`，写反完全合法、tsc 与任何测试都拦不住，
 * 而写反的后果是每次拖拽都被判成归入项目（closestCenter 几乎总含 `project:` 项，filter 恒非空）。
 *
 * **坞的命中资格由 `dockAllowed` 一处裁决**（调用方传 `laneRef.current === "dock"`，ref 逐帧同步、
 * 零延迟）。此前这条闸挂在药丸的 `useDroppable({disabled})` 上，那是 state 驱动的：值要先经
 * 一次 React 提交、再经 `useDroppable` 自己的 effect dispatch 一次，才落进 dnd-kit 的可碰撞集合——
 * 比车道慢两跳。慢出来的窗口两个方向都会咬人：刚释放（坞视觉已收）时 `over` 仍指着药丸，松手
 * 落一次用户以为已放弃的真实投递；刚进档（坞已展开）时药丸还是禁用的，对着药丸松手却漏接。
 * 放在这里则两侧同拍。**两条路都要滤**：`pointerHits` 与 `fallback()`（closestCenter 会把坞药丸
 * 的矩形一并算进去）在无资格时都得剔掉 `dock:`，只滤前者会让兜底路把坞重新放进来。
 */
export function preferProjectCollisions({
  pointerHits,
  fallback,
  dockAllowed,
  activeProjectGoalId = null,
}: {
  pointerHits: Collision[];
  /** 惰性：指针已落在项目卡内时 closestCenter 的结果注定被丢弃，没必要每帧遍历全部 droppable。 */
  fallback: () => Collision[];
  /** 当前是否在 dock 车道；false 时坞不参与命中（排序/收纳因此不被坞拦）。 */
  dockAllowed: boolean;
  /**
   * 被拖行来自哪个项目组；非项目区来源为 null。
   *
   * 项目区来源时**同组的行优先于组卡片**：卡片是几百像素的大块、行浮在它里面，沿用
   * 「落在卡内只认卡」会把组内行的碰撞整个吞掉，组内收纳永远命中不到行。只认同组行——
   * 隔壁组的行不进这一档，与「跨组不认」是同一条规则的第二处落点。
   */
  activeProjectGoalId?: string | null;
}): Collision[] {
  const isDock = (collision: Collision) => String(collision.id).startsWith("dock:");
  // 坞药丸浮在列表之上:指针同时落在药丸与其下方行/项目组的矩形内时只认坞。
  if (dockAllowed) {
    const dock = pointerHits.filter(isDock);
    if (dock.length > 0) return dock;
  }
  const hits = dockAllowed ? pointerHits : pointerHits.filter((collision) => !isDock(collision));
  if (activeProjectGoalId !== null) {
    const prefix = todoProjectRowIdPrefix(activeProjectGoalId);
    const rows = hits.filter((collision) => String(collision.id).startsWith(prefix));
    if (rows.length > 0) return rows;
  }
  const projects = hits.filter((collision) => String(collision.id).startsWith("project:"));
  if (projects.length > 0) return projects;
  const rest = fallback();
  return dockAllowed ? rest : rest.filter((collision) => !isDock(collision));
}
