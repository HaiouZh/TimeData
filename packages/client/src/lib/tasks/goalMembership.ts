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
  /** 未完成成员。由 listTasks 在进入 buckets 前按项目区状态排序。 */
  tasks: Task[];
  /** 已完成成员数，及它们名下的已完成子任务数；不持有长期增长的已完成任务数组。 */
  doneCount: number;
  /** 近 RECENT_DONE_WINDOW_DAYS 天完成的成员数，及它们名下的已完成子任务数。 */
  recentDoneCount: number;
  /** 原始 goal.members 数组长度，含 track 成员与悬空 ref。 */
  memberCount: number;
  /**
   * 未完成成员 id → 它名下未完成子任务数（`skipped` 不计）。
   *
   * **刻意不是加总好的标量**：筛选激活时页面会裁剪 `tasks`，而标量结构上不可能跟着裁，
   * 「还剩 N」就会把看不见的成员名下的子任务算进去、用户展开组数不出 N。按成员分桶后
   * 求和发生在消费端（`summarizeProjectGroup`），裁剪自动生效。
   *
   * 口径与手头区 `atHandPendingTotal` 同源；已完成成员不进本表（它们在组内不渲染）。
   */
  pendingChildByMember: ReadonlyMap<string, number>;
  /**
   * 被未完成前置挡住的成员 id → 挡着它的那些东西的标题。**刻意不是加总好的标量**：
   * 筛选激活时页面会裁剪 tasks，标量结构上不可能跟着裁，徽章数字就会把看不见的成员算进去。
   *
   * 由本 builder 按 `blockedTitlesByTaskId` 入参自填。**标题与 id 同一处产出**：分成
   * 「builder 声明、调用方回填」两处的话，任何一个不经 listTasks 的调用方都会让徽章静默归零。
   */
  blockedByMember: ReadonlyMap<string, string[]>;
}

/** 标题行「近 N 天 +M」的窗口长度。 */
export const RECENT_DONE_WINDOW_DAYS = 7;

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
  now: Date,
  /**
   * parentId → 子任务（`skipped` 已由调用方剔除）。**必传**：给默认空 Map 会让「忘了传」
   * 静默退回不含子任务的旧口径，而那正是本次要修的东西。
   */
  childrenByParent: ReadonlyMap<string, readonly Task[]>,
  /**
   * 任务 id → 挡着它的那些东西的标题（调用方按 `buildBlockedByIndex` 的结果解好标题）。
   * **必传**：给默认空 Map 会让「忘了传」静默退回徽章恒零的旧口径，而那正是本次要修的东西。
   * 本函数只筛出组内成员那部分，不关心表里还有谁。
   */
  blockedTitlesByTaskId: ReadonlyMap<string, string[]>,
): TodoProjectGroup[] {
  const goalById = new Map<string, Goal>();
  for (const goal of goals) goalById.set(goal.id, goal);

  const recentSince = new Date(now.getTime() - RECENT_DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const recentUntil = now.toISOString();

  const draft = new Map<
    string,
    { group: Omit<TodoProjectGroup, "blockedByMember">; latest: string; pendingChildByMember: Map<string, number> }
  >();
  for (const task of memberTasks) {
    const membership = index.get(task.id);
    if (!membership) continue;
    let entry = draft.get(membership.goalId);
    if (!entry) {
      const pendingChildByMember = new Map<string, number>();
      entry = {
        group: {
          goalId: membership.goalId,
          goalTitle: membership.goalTitle,
          tasks: [],
          doneCount: 0,
          recentDoneCount: 0,
          pendingChildByMember,
          memberCount: goalById.get(membership.goalId)?.members?.length ?? 0,
        },
        latest: "",
        pendingChildByMember,
      };
      draft.set(membership.goalId, entry);
    }
    if (task.done) {
      entry.group.doneCount += 1;
      const completedAt = task.completedAt ?? "";
      if (completedAt >= recentSince && completedAt <= recentUntil) entry.group.recentDoneCount += 1;
    } else entry.group.tasks.push(task);
    for (const child of childrenByParent.get(task.id) ?? []) {
      if (child.skipped) continue; // 与 atHandPendingTotal 同源：skipped 是"删·跳"留痕，不是活
      if (child.done) {
        entry.group.doneCount += 1;
        const completedAt = child.completedAt ?? "";
        if (completedAt >= recentSince && completedAt <= recentUntil) entry.group.recentDoneCount += 1;
      } else if (!task.done) {
        // 只数未完成成员名下的——理由见 TodoProjectGroup.pendingChildByMember 的注释
        entry.pendingChildByMember.set(task.id, (entry.pendingChildByMember.get(task.id) ?? 0) + 1);
      }
    }
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
    .map((entry) => {
      // 组装点在这里而不是创建 entry 时：那时 group.tasks 还是空的，成员是一条条 push 进去的。
      const blockedByMember = new Map<string, string[]>();
      for (const task of entry.group.tasks) {
        const titles = blockedTitlesByTaskId.get(task.id);
        if (titles !== undefined && titles.length > 0) blockedByMember.set(task.id, titles);
      }
      return { ...entry.group, blockedByMember };
    });
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

/**
 * `GoalSchema.members` 的数组上限（`packages/shared/src/entitySchemas.ts` 的 `.max(500)`）。
 *
 * 这里重复一份字面量而不是从 shared 导出常量：改 `entitySchemas.ts` 属仓库的「schema 变更」停手边界，
 * 而这个值本身没变。两处漂移由 goalMembership.test.ts 里那条 GoalSchema 对拍用例钉住。
 */
export const GOAL_MEMBERS_MAX = 500;

/** 项目成员数达到上限的 90% 时给出预警。 */
export function isProjectMemberCountNearCap(memberCount: number): boolean {
  return memberCount >= Math.ceil(GOAL_MEMBERS_MAX * 0.9);
}

/**
 * 归入项目被拒的原因；null = 可以入组。
 *
 * `recurring` 是**任务侧**的，由 `projectAssignBlock` 判；`inactive` 是**目标侧**的
 * （目标组已归档或已改成 theme），只能由写入入口在拿到 goal 行后自己判，故不在那个函数里。
 *
 * **`inactive` 先于下面那条「更根本的原因优先」规则**，别按那条把它挪到准入之后：它说的不是
 * 「这东西装不进这个组」，而是「这个落点根本不是合法落点」，后面的准入判定（含拿 members 长度
 * 算 500 闸）建立在「目标确实是个 active project」之上，顺序反了就是拿一个 theme 的成员数组去算。
 * 它与 `full` 虽同属目标侧却一头一尾，就是这个原因——`full` 只有在目标合法时才有意义。
 *
 * **`"subtask"` 成员仍然活着，别当死代码删**（这句在阶段3 一度被写成「已成死代码」，是错的）：
 * 阶段3 解的是**库层**那道锁——`assignTaskToProject` 不再按 `parentId` 拒绝，详情面板的「归项目」
 * 能把子任务归进任意项目。但**拖拽这条路没解**：`todoDnd.ts` 对子任务只放行「拖回父所在的那个组」
 * （升根回组），拖去别的组仍返回 null，`todoDockDrop.ts` 与 `TodoPage.tsx` 照常弹本文案。三处分支
 * 全部可达，删了会让拖拽从「有提示的拒绝」变成「拖了没反应」。
 *
 * 两条路口径不一致是**已知状态**：库层放行、拖拽层只认「回父所在的组」。要统一得改 DnD 判定层，
 * 那超出阶段3 的范围（那几个文件在本阶段的零 diff 名单上）。已登记 backlog。
 */
export type ProjectAssignBlock = "subtask" | "recurring" | "full" | "inactive";

/**
 * `GoalSchema.members` 还装得下再加 `addCount` 个吗。
 *
 * 单条入口传 1，批量入口传**整批的新增数**。批量必须一次判完：逐条问「已经满了吗」要到第 501 条
 * 才抛，而前 500 条已经写进去了，与批量入口「全成功或全失败」的契约直接矛盾。
 */
export function exceedsGoalMemberCap(memberCount: number, addCount: number): boolean {
  return memberCount + addCount > GOAL_MEMBERS_MAX;
}

/**
 * 任务侧准入（design §成员准入 的前两条），**不含 500 上限**。
 *
 * 阶段3 起子任务可归项目，只余重复模板与 occurrence 合成 `recurring` 一支：
 * 对用户是同一件事，文案一字不差。
 *
 * 三个字段都要 `?? null`：喂进来的是 `db.tasks.get` 的**裸行**（不过 `TaskSchema.parse`），
 * 老行缺字段读出来是 `undefined`。少一个防护，缺那个字段的行就被永久判成 recurring，
 * 用户怎么拖都归不了组，且没有任何提示能指向真因。
 */
export function taskAssignBlock(
  task: Pick<Task, "parentId" | "recurrence" | "ruleId">,
): Extract<ProjectAssignBlock, "recurring"> | null {
  if ((task.recurrence ?? null) !== null || (task.ruleId ?? null) !== null) return "recurring";
  return null;
}

/**
 * 成员准入：任务侧条件 + 500 上限。
 *
 * - `memberCount` 传 `goal.members` 的**数组长度**（含 track 成员与悬空 ref），不是可解析的 task 数——
 *   500 是 schema 对整个数组的硬闸，撞上后 parse 失败会让整个 goal 从 UI 与同步里消失，不是报错。
 *
 * 准入优先于满员：满员只是「这个组装不下」，而重复待办是「这东西本身不参与归属」，
 * 换个组也一样，先说更根本的那个原因。
 */
export function projectAssignBlock(
  task: Pick<Task, "parentId" | "recurrence" | "ruleId">,
  memberCount: number,
): ProjectAssignBlock | null {
  return taskAssignBlock(task) ?? (exceedsGoalMemberCap(memberCount, 1) ? "full" : null);
}

export function projectAssignBlockMessage(block: ProjectAssignBlock, goalTitle: string): string {
  switch (block) {
    case "subtask":
      return "子任务不能单独归入项目，先把它拽成独立任务";
    case "recurring":
      return "重复待办本期不能归入项目";
    case "full":
      return `「${goalTitle}」的成员已满 ${GOAL_MEMBERS_MAX}，无法再加入`;
    case "inactive":
      return `「${goalTitle}」已归档或不再是项目，无法加入`;
  }
}
