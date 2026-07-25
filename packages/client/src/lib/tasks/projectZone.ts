import type { Task } from "@timedata/shared";
import type { TodoProjectGroup } from "./goalMembership.js";
import { placementForTask } from "./placement.js";

/**
 * 项目区的呈现判定。数据层（goalMembership.ts）只管「谁属于哪个组」，
 * 这里管「这条成员当前在哪」「这组该显示什么」——两者口径不同，别合并。
 *
 * 本文件只依赖 placement.js（同为纯函数），不碰 db / React，故落 node 快桶。
 */

/**
 * 成员的当前状态：归属轴之外的三根轴各占一态。
 * `idle`（躺着）是默认多数态，渲染层对它不画胶囊——判定保留四态，取舍留在组件里。
 *
 * **没有「逾期」态是刻意的**：`placementForTask` 只对重复模板与 occurrence 给 `overdue`，
 * 一次性任务过期会被退回 `inbox`（placement.ts:68）；而项目区的归集守卫是
 * `recurrence === null && ruleId === null`，把前两类挡在门外。也就是说项目区成员
 * 拿不到 overdue，硬加一个态就是死代码。
 */
export type ProjectMemberState =
  | { kind: "at-hand" }
  | { kind: "today" }
  | { kind: "scheduled"; scheduledAt: string }
  | { kind: "idle" };

/**
 * 焦点轴优先于时间轴：一条被抓到手头又排了今天的任务，用户当下的答案是「在手头」。
 *
 * `sessionId` 是**历史归属指针**不是当前状态标记（见 evergreen todo/at-hand），
 * 因此必须与*当前活跃*场 id 相等才算在手头，非空不等于在手头。
 */
export function projectMemberState(
  task: Task,
  options: { handSessionId: string | null; now: Date },
): ProjectMemberState {
  if (options.handSessionId !== null && (task.sessionId ?? null) === options.handSessionId) {
    return { kind: "at-hand" };
  }
  const placement = placementForTask(task, options.now);
  // 不透传 placement.overdue：项目区成员恒为非重复，拿不到那一支（见上方类型注释）。
  if (placement.pool === "today") return { kind: "today" };
  if (placement.pool === "upcoming" && task.scheduledAt !== null) {
    return { kind: "scheduled", scheduledAt: task.scheduledAt };
  }
  return { kind: "idle" };
}

export interface ProjectGroupSummary {
  /** 未完成成员数 */
  remaining: number;
  /**
   * 可解析成员总数（未完成 + 已完成）。**只数 task 成员**——与 goals 页
   * `buildGoalOverview` 的项目进度口径不同，那边把 track 成员也算进分母。
   */
  total: number;
  allDone: boolean;
}

export function summarizeProjectGroup(group: TodoProjectGroup): ProjectGroupSummary {
  const remaining = group.tasks.length;
  const total = remaining + group.doneTasks.length;
  return { remaining, total, allDone: remaining === 0 && total > 0 };
}

export interface ProjectChip {
  goalId: string;
  goalTitle: string;
}

/**
 * taskId → 它所属的项目，供今天 / 已排期 / 手头三区渲染可点的项目名 chip。
 * 只索引未完成成员：已完成成员不在项目区显示集合里，chip 点过去也无处可展开。
 */
export function projectChipIndex(groups: readonly TodoProjectGroup[]): Map<string, ProjectChip> {
  const index = new Map<string, ProjectChip>();
  for (const group of groups) {
    for (const task of group.tasks) index.set(task.id, { goalId: group.goalId, goalTitle: group.goalTitle });
  }
  return index;
}

/**
 * 该画「已有去处」绿竖条的 task id：已归 active 目标、**且没有项目名 chip**。
 *
 * 排他打开后，行内绿竖条与项目名 chip 是同一件事的两种说法，同屏出现是重复信号。
 * chip 更具体（说得出组名、点得开），故 chip 优先、竖条退回只表达 theme 归属。
 * 裁剪显式做在这里，不靠组件内「有 chip 就不画竖条」的隐式耦合。
 */
export function goalBarTaskIds(
  goalLinkedIds: ReadonlySet<string>,
  chips: ReadonlyMap<string, ProjectChip>,
): Set<string> {
  const ids = new Set<string>();
  for (const id of goalLinkedIds) {
    if (!chips.has(id)) ids.add(id);
  }
  return ids;
}
