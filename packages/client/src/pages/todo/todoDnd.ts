import type { Task } from "@timedata/shared";

export type TodoPool = "today" | "inbox";

/** dnd-kit container id 域：池容器或父任务容器。 */
export type TodoContainer =
  | { kind: "pool"; pool: TodoPool }
  | { kind: "parent"; parentId: string };

/** drop 后要执行的语义化操作。 */
export type TodoDragOperation =
  | { kind: "reorder"; containerId: string }
  | { kind: "move-to-parent"; parentId: string }
  | { kind: "promote-to-root"; pool: TodoPool }
  | { kind: "schedule-root"; pool: TodoPool };

/**
 * 解析 container id 字符串。仅接受：
 * - `pool:today` / `pool:inbox`
 * - `parent:<非空 id>`
 * 其它（含 `parent:` 空 id）返回 null。
 */
export function parseTodoContainerId(value: string | null | undefined): TodoContainer | null {
  if (!value) return null;
  if (value === "pool:today") return { kind: "pool", pool: "today" };
  if (value === "pool:inbox") return { kind: "pool", pool: "inbox" };
  if (value.startsWith("parent:")) {
    const parentId = value.slice("parent:".length);
    if (!parentId) return null;
    return { kind: "parent", parentId };
  }
  return null;
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
 * - 同一容器 → reorder（调用方再根据 sortable item 顺序计算新排序）。
 * - child → 池（today/inbox）→ promote-to-root。
 * - root → parent → move-to-parent。
 * - root 在 today/inbox 之间 → schedule-root（schedule 或 unschedule）。
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
    return { kind: "reorder", containerId: activeContainerId };
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
 * 由一次 drag-over 的目标，反查它归属的 root 任务 id（用于 hover-intent 判定）。
 * - 池容器（pool:today/inbox）：over 自身就是根行，root = overId。
 * - parent 容器（parent:<X>）：root = X（无论 over 是子任务行还是落点区）。
 * 无法归属（非法/缺失容器、upcoming 等）返回 null。
 */
export function hoveredRootIdFromOver(overContainerId: string, overId: string): string | null {
  const container = parseTodoContainerId(overContainerId);
  if (!container) return null;
  if (container.kind === "pool") return overId;
  return container.parentId;
}

export interface ArmTargetInput {
  overContainerId: string;
  overId: string;
  activeId: string;
  /** 当前被拖项的 parentId（root 为 null）。 */
  activeParentId: string | null;
}

/**
 * 由 drag-over 计算"可激活展开"的目标 root id；无合法目标返回 null。
 * 排除：归属失败、悬停自身、悬停被拖子任务自己的父（已展开、无意义）。
 */
export function armTargetFromDragOver({
  overContainerId,
  overId,
  activeId,
  activeParentId,
}: ArmTargetInput): string | null {
  const root = hoveredRootIdFromOver(overContainerId, overId);
  if (!root) return null;
  if (root === activeId) return null;
  if (root === activeParentId) return null;
  return root;
}

export interface ResolveTodoDragWithArmInput {
  activeContainerId: string;
  overContainerId: string;
  overId: string;
  activeId: string;
  activeParentId: string | null;
  /** hover-intent 当前激活展开的目标 root id（无则 null）。 */
  armedParentId: string | null;
}

/**
 * drag end 的语义解析，叠加 hover-intent 激活态：
 * 若存在已激活目标 A，且松手时 over 仍落在 A 上（A 的行或 A 的落点区），
 * 则把目标容器视为 `parent:A`，交由 {@link resolveTodoDragOperation} 得到 move-to-parent；
 * 否则退化为常规 over→over 判定（reorder / schedule-root / promote 等不变）。
 */
export function resolveTodoDragWithArm({
  activeContainerId,
  overContainerId,
  overId,
  activeId,
  activeParentId,
  armedParentId,
}: ResolveTodoDragWithArmInput): TodoDragOperation | null {
  let targetContainerId = overContainerId || activeContainerId;
  if (armedParentId && armedParentId !== activeId) {
    const overRoot = hoveredRootIdFromOver(overContainerId, overId);
    if (overRoot === armedParentId) {
      targetContainerId = `parent:${armedParentId}`;
    }
  }
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