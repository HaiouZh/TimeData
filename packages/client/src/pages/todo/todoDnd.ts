import type { Modifier } from "@dnd-kit/core";
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

/**
 * 拖拽预览横向夹取，避免横向滚动条：
 * - 拖根任务：只允许向右缩进，夹到 `[0, 28]`。
 * - 拖子任务：只允许向左升级，夹到 `[-28, 0]`，让"向左拽出父"的手势有跟手的虚影。
 *
 * 仅影响渲染 transform；落点判定仍用 `handleDragMove` 里的 raw `delta.x`。
 */
export const clampTodoIndentPreview: Modifier = ({ transform, active }) => {
  const containerId = (active?.data.current as { containerId?: string } | undefined)?.containerId ?? "";
  const isChild = parseTodoContainerId(containerId)?.kind === "parent";
  const x = isChild
    ? Math.min(0, Math.max(transform.x, -TODO_CHILD_INDENT_PX))
    : Math.max(0, Math.min(transform.x, TODO_CHILD_INDENT_PX));
  return { ...transform, x };
};

/** dnd-kit container id 域：池容器或父任务容器。 */
export type TodoContainer = { kind: "pool"; pool: TodoPool } | { kind: "parent"; parentId: string };

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
 * 由一次 drag-over 的目标，反查它归属的 root 任务 id（用于缩进候选父判定）。
 * - 池容器（pool:today/inbox）：over 自身就是根行，root = overId。
 * - parent 容器（parent:<X>）：root = X（无论 over 是子任务行还是落点区）。
 * 无法归属（非法/缺失容器、upcoming 等）返回 null。
 */
export function hoveredRootIdFromOver(
  overContainerId: string,
  overId: string,
  fallbackContainerId?: string,
): string | null {
  const container = parseTodoContainerId(overContainerId) ?? parseTodoContainerId(fallbackContainerId);
  if (!container) return null;
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
  targetPool: TodoPool | null;
}

export function resolveTodoDragWithIndent({
  activeContainerId,
  activeParentId,
  activeId,
  activeHasChildren,
  indentLevel,
  rootAboveId,
  targetPool,
}: ResolveTodoDragWithIndentInput): TodoDragOperation | null {
  const canBecomeChild =
    indentLevel === "child" && !activeHasChildren && rootAboveId !== null && rootAboveId !== activeId;
  const targetContainerId = canBecomeChild ? `parent:${rootAboveId}` : targetPool ? `pool:${targetPool}` : "";

  return resolveTodoDragOperation({
    activeContainerId,
    targetContainerId,
    activeParentId,
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
