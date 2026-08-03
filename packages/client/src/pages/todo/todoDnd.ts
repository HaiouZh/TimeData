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

/**
 * 由横向位移判定三档车道，dock 档与缩进档同构叠加：
 * - `base="root"`（拖根任务）：左拉越过 -28 进 dock，回撤到 -12 内释放回 root。
 * - `base="child"`（拖子任务）：-28 先升 root（缩进档既有语义），出坞阈值按基线加深一档到 -56，
 *   释放线随之左移到 -40——升根瞬间绝不同时满足出坞条件，两次越档等距、可分辨。
 * - root/child 之间的判定原样委托 `resolveIndentLevel`，右移语义一字不变。
 * - `keyboard=true`（键盘拖拽）恒返回基线档：跨栏键盘移动会产生很大的 delta.x，
 *   不判 sensor 会把键盘重排误判成出坞/换档；恒基线等价于"视作 deltaX=0"。
 */
export function resolveTodoDragLane(
  deltaX: number,
  previous: TodoDragLane,
  base: TodoIndentLevel = "root",
  keyboard = false,
): TodoDragLane {
  if (keyboard) return base;
  const origin = base === "child" ? -TODO_CHILD_INDENT_PX : 0;
  const engage = origin - TODO_CHILD_INDENT_PX;
  const release = origin - TODO_INDENT_RELEASE_PX;
  if (previous === "dock") {
    if (deltaX < release) return "dock";
    return resolveIndentLevel(deltaX, "root", base);
  }
  if (deltaX <= engage) return "dock";
  return resolveIndentLevel(deltaX, previous, base);
}

/**
 * 拖拽预览横向夹取，避免横向滚动条：
 * - 拖根任务：只允许向右缩进，夹到 `[0, 28]`。
 * - 拖子任务：只允许向左升级，夹到 `[-28, 0]`，让"向左拽出父"的手势有跟手的虚影。
 *
 * 仅影响渲染 transform；落点判定仍用 `handleDragMove` 里的 raw `delta.x`。
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
  | { kind: "schedule-root"; pool: TodoPool }
  | { kind: "assign-to-project"; goalId: string };

/** 项目组 droppable 的 container id。组件与判定层共用它，避免两处手写前缀漂移。 */
export function projectContainerId(goalId: string): string {
  return `project:${goalId}`;
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
  // 手头源不开放投坞（区内重排专属）：todoDockTargets 已不渲染，这里是隐藏规则漏了时的兜底。
  if (parseTodoContainerId(activeContainerId)?.kind === "hand") return { kind: "invalid", target };
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
 * `activeParentInHand`：被拖子任务的父是否在手头。容器 id 只有 `parent:<父id>` 一种形状，
 * 收件箱子任务与手头子任务在这一层完全同形、判定层本身分不出来——这个参数由调用方
 * （TodoPage，能查 `buckets.atHand`）算好了传进来。手头区整个区都不出坞（父行本就不出，
 * 子任务跟着一致，见用户反馈「手头收掉扩展坞，回池已经有 × 按钮了」）；收件箱子任务的坞
 * 不受影响，默认值 `false` 保证不传这个参数时行为一字不变。
 */
export function todoDockTargets(
  activeContainerId: string,
  projects: readonly { goalId: string }[],
  activeParentInHand = false,
): TodoDockTarget[] {
  const active = parseTodoContainerId(activeContainerId);
  // 手头区只做区内重排，坞不对手头源显示任何药丸。子任务的父若在手头，同一条规则也套用。
  if (active?.kind === "hand") return [];
  if (active?.kind === "parent" && activeParentInHand) return [];
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

  // → 项目组：只收根任务。子任务不做「先升根再入组」的复合动作——一个手势改两件事、
  // 且拆父子关系不可撤销，判为无效由调用方给拒绝反馈。
  if (target.kind === "project") {
    if (active.kind !== "pool" || activeParentId !== null) return null;
    return { kind: "assign-to-project", goalId: target.goalId };
  }

  // 项目区的行不注册 draggable（design §动作二 dnd 身份规则），active 不可能是项目容器；防御闸。
  // 注意：此刻它对返回值零影响——下面六个分支都要求 active 是 pool/parent/hand，落到末尾同样 return null。
  // 留着是为了让「项目容器不作 active」这条规则在代码里有据可依，且将来新增分支时不至于漏掉它。
  if (active.kind === "project") return null;

  // hand → parent:X —— 手头行被收纳为 X 的子任务（区内收纳）
  if (active.kind === "hand" && target.kind === "parent") {
    return { kind: "move-to-parent", parentId: target.parentId };
  }

  // parent:X → hand —— 子任务升为根任务并站到手头。落库走 taskNesting.promoteTaskToHand
  //（先升根再抓，grabTaskToHand 对子任务的硬拒因此不会被这条路径触发）。
  if (active.kind === "parent" && target.kind === "hand") {
    return { kind: "promote-to-hand" };
  }

  // child → pool：升级为 root（child 不允许把别的 root 拖进来——一层约束）
  if (active.kind === "parent" && target.kind === "pool") {
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
 * - 池容器（pool:today/inbox）：over 自身就是根行，root = overId。
 * - parent 容器（parent:<X>）：root = X（无论 over 是子任务行还是落点区）。
 * - hand 容器：**仅当拖拽来源也是 hand 时** root = overId；否则 null。
 * 无法归属（非法/缺失容器、upcoming 等）返回 null。
 *
 * 第三参既是容器解析失败时的兜底，也是「拖拽来源」判据。收纳只在手头区内成立——
 * 外区任务要归到手头某件活底下，正确路径是先入手头再在区内收敛。这道守卫必须落在本函数，
 * 因为收纳高亮（handleDragOver）与落库判定共用它；只拦落库会留下「亮了高亮却无事发生」。
 */
export function hoveredRootIdFromOver(
  overContainerId: string,
  overId: string,
  activeContainerId?: string,
): string | null {
  // 投递坞不是缩进落点:dock id 解析不进 TodoContainer,会 fall 到 activeContainerId(通常是池)
  // 把 dock id 字符串当「根行 id」返回,下游拿它拼 parent:<dock:…> 落成垃圾 move-to-parent。
  if (parseTodoDockId(overContainerId) !== null || parseTodoDockId(overId) !== null) return null;
  const container = parseTodoContainerId(overContainerId) ?? parseTodoContainerId(activeContainerId);
  if (!container) return null;
  // 项目区没有可作缩进父的根行，恒返回 null 让缩进系统对它让位。
  if (container.kind === "project") return null;
  if (container.kind === "hand") {
    return parseTodoContainerId(activeContainerId)?.kind === "hand" ? overId : null;
  }
  if (container.kind === "pool") return overId;
  return container.parentId;
}

export interface ResolveTodoDragWithIndentInput {
  activeContainerId: string;
  activeParentId: string | null;
  activeId: string;
  activeHasChildren: boolean;
  indentLevel: TodoIndentLevel;
  rootAboveId: string | null;
  targetContainer: TodoContainer | null;
}

export function resolveTodoDragWithIndent({
  activeContainerId,
  activeParentId,
  activeId,
  activeHasChildren,
  indentLevel,
  rootAboveId,
  targetContainer,
}: ResolveTodoDragWithIndentInput): TodoDragOperation | null {
  const canBecomeChild =
    indentLevel === "child" &&
    !activeHasChildren &&
    rootAboveId !== null &&
    rootAboveId !== activeId &&
    // 项目组不是缩进落点。第二道保险：hoveredRootIdFromOver 已让项目容器恒返回 null，
    // 但那是调用方传进来的值，斜着拖进项目组不该因为一个错传就变成拆/接父子关系。
    targetContainer?.kind !== "project";
  const targetContainerId = canBecomeChild
    ? `parent:${rootAboveId}`
    : targetContainer
      ? todoContainerId(targetContainer)
      : "";

  return resolveTodoDragOperation({ activeContainerId, targetContainerId, activeParentId });
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
 */
export function preferProjectCollisions({
  pointerHits,
  fallback,
}: {
  pointerHits: Collision[];
  /** 惰性：指针已落在项目卡内时 closestCenter 的结果注定被丢弃，没必要每帧遍历全部 droppable。 */
  fallback: () => Collision[];
}): Collision[] {
  // 坞药丸浮在列表之上:指针同时落在药丸与其下方行/项目组的矩形内时只认坞。
  const dock = pointerHits.filter((collision) => String(collision.id).startsWith("dock:"));
  if (dock.length > 0) return dock;
  const projects = pointerHits.filter((collision) => String(collision.id).startsWith("project:"));
  return projects.length > 0 ? projects : fallback();
}
