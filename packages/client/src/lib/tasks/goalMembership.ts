import type { Goal, Task } from "@timedata/shared";

/**
 * goal → task 的归属索引与项目区投影。
 *
 * 本文件是**零运行时依赖的叶子**：只 import type。原因是 lib/goals.ts 已经 import lib/tasks.ts，
 * 而 lib/tasks.ts 要用这里的函数——把它们放进 goals.ts 会成环；放进 goalUnassigned.ts 则会因为
 * 那个文件 import 了 pages/goals/ 而把整个 pages 子树拖进 lib/tasks.ts 的依赖图。
 *
 * 读的是 db.goals 的裸行，不做 GoalSchema 解析：schema 的 superRefine 会因单个成员重复 reject 整行，
 * 那会让整个目标的归属静默失效；且 status/members/prerequisites 都有 schema 默认值，老行可能缺字段。
 */

/** 一条任务所属的 active project。 */
export interface ProjectMembership {
  goalId: string;
  goalTitle: string;
}

/** 待办页项目区的一组。 */
export interface TodoProjectGroup {
  goalId: string;
  goalTitle: string;
  /** 未完成成员，保持传入顺序（listTasks 按 sortOrder 读表）。 */
  tasks: Task[];
  /**
   * 已完成成员，保持传入顺序。不进 `tasks`（项目区显示集合只要未完成的），
   * 但参与组间排序键，且喂展开态尾部的「已完成 N 条」折叠子区。
   */
  doneTasks: Task[];
}

/**
 * 被任一 active 目标引用的 task id（**不看 kind**），用于行内绿竖条 `inGoal`。
 *
 * 与 projectMemberIndex 口径不同、不得互相派生：若用那个 Map 派生本 Set，
 * 只属于 theme 目标的任务会失去绿竖条。
 */
export function goalLinkedTaskIds(goals: readonly Goal[]): Set<string> {
  const ids = new Set<string>();
  for (const goal of goals) {
    if (goal.status !== "active") continue;
    for (const member of goal.members ?? []) {
      if (member.kind === "task") ids.add(member.id);
    }
  }
  return ids;
}

/** candidate 是否比 held 更该拥有这条任务：updatedAt 新者胜，并列取 id 字典序小者。 */
function winsOwnership(candidate: Goal, held: Goal): boolean {
  const byUpdated = (candidate.updatedAt ?? "").localeCompare(held.updatedAt ?? "");
  if (byUpdated !== 0) return byUpdated > 0;
  return candidate.id.localeCompare(held.id) < 0;
}

/**
 * 归属轴索引：只认 status==="active" 且 kind==="project" 的目标。
 *
 * members 没有跨目标唯一约束，一条任务可同时挂多个 active project（存量与跨设备并发都可达）。
 * 读侧兜底取 updatedAt 最新者、并列取 id 字典序小者，保证 db.goals.toArray() 返回顺序变化时结果稳定。
 */
export function projectMemberIndex(goals: readonly Goal[]): Map<string, ProjectMembership> {
  const index = new Map<string, ProjectMembership>();
  const holder = new Map<string, Goal>();
  for (const goal of goals) {
    if (goal.status !== "active" || goal.kind !== "project") continue;
    for (const member of goal.members ?? []) {
      if (member.kind !== "task") continue;
      const held = holder.get(member.id);
      if (held && !winsOwnership(goal, held)) continue;
      holder.set(member.id, goal);
      index.set(member.id, { goalId: goal.id, goalTitle: goal.title });
    }
  }
  return index;
}

/**
 * 组装项目区分组。
 *
 * memberTasks 由 listTasks 在主循环里收集：已按 sortOrder 排序、已排除子任务与重复待办、
 * 且已用 index 过滤过（只含真正的项目成员）。查不到任务的成员 ref 天然被丢弃、不计入计数。
 *
 * 组间排序键 = 该组全部可解析成员（**含已完成**）的 max(updatedAt)，与显示集合无关——
 * 这样"某组全部完成"不会让它掉到末尾。无可解析成员的组不出现（纯 track 目标不进项目区）。
 */
export function buildTodoProjectGroups(
  goals: readonly Goal[],
  index: ReadonlyMap<string, ProjectMembership>,
  memberTasks: readonly Task[],
): TodoProjectGroup[] {
  const goalById = new Map<string, Goal>();
  for (const goal of goals) goalById.set(goal.id, goal);

  const draft = new Map<string, { group: TodoProjectGroup; latest: string }>();
  for (const task of memberTasks) {
    const membership = index.get(task.id);
    if (!membership) continue;
    let entry = draft.get(membership.goalId);
    if (!entry) {
      entry = {
        group: { goalId: membership.goalId, goalTitle: membership.goalTitle, tasks: [], doneTasks: [] },
        latest: "",
      };
      draft.set(membership.goalId, entry);
    }
    if (task.done) entry.group.doneTasks.push(task);
    else entry.group.tasks.push(task);
    if (task.updatedAt > entry.latest) entry.latest = task.updatedAt;
  }

  return [...draft.values()]
    .sort((a, b) => {
      const aKey = a.latest || goalById.get(a.group.goalId)?.updatedAt || "";
      const bKey = b.latest || goalById.get(b.group.goalId)?.updatedAt || "";
      const byLatest = bKey.localeCompare(aKey);
      if (byLatest !== 0) return byLatest;
      const aCreated = goalById.get(a.group.goalId)?.createdAt ?? "";
      const bCreated = goalById.get(b.group.goalId)?.createdAt ?? "";
      return bCreated.localeCompare(aCreated);
    })
    .map((entry) => entry.group);
}

/** 该目标当前拥有的 task 成员 id；非 active 或非 project 一律空。 */
export function ownedProjectTaskIds(goal: Goal): string[] {
  if (goal.status !== "active" || goal.kind !== "project") return [];
  const ids: string[] = [];
  for (const member of goal.members ?? []) {
    if (member.kind === "task") ids.push(member.id);
  }
  return ids;
}

/**
 * 一次目标更新中「失去 active project 归属」的 task id。
 *
 * 用前后状态的差集统一覆盖四条释放通道，而不是给每条通道写特判：
 * status active→archived、kind project→theme、members 整包替换时被移除的成员、以及它们的组合。
 * 将来新增的 updateGoal 调用方自动被覆盖。
 */
export function releasedProjectTaskIds(before: Goal, after: Goal): string[] {
  const kept = new Set(ownedProjectTaskIds(after));
  return ownedProjectTaskIds(before).filter((taskId) => !kept.has(taskId));
}
