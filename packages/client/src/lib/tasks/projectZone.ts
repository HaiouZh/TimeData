import type { Task } from "@timedata/shared";
import type { TodoProjectGroup } from "./goalMembership.js";
import type { TodoGravitySettings } from "./gravity.js";
import { isTaskSunken } from "./gravity.js";
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

/**
 * 项目区成员行的**动作**口径：焦点轴（在不在手头）与时间轴（换池箭头指哪边）分开返回。
 *
 * 与 `projectMemberState` 的四态互斥刻意不同——那个答的是「当前在哪」，一条一个答案、焦点轴压过
 * 时间轴，适合画胶囊；拿它开关按钮会把「在手头且已排今天」判成没排今天，箭头指反。
 * 动作是两根独立的轴：抓手动作看焦点轴，换池动作看时间轴，谁也不遮谁。
 *
 * `pool` 只有两值：非今天的（收件箱 / 排到未来）动作都是「排进今天」，故一律给 `inbox`。
 * 不给 `upcoming` 是因为 TaskRow 拿它会再画一枚排期日胶囊，与项目区自己的状态胶囊重复。
 */
export function projectMemberRowActions(
  task: Task,
  options: { handSessionId: string | null; now: Date },
): { atHand: boolean; pool: "today" | "inbox" } {
  const atHand = options.handSessionId !== null && (task.sessionId ?? null) === options.handSessionId;
  const pool = placementForTask(task, options.now).pool === "today" ? "today" : "inbox";
  return { atHand, pool };
}

export interface ProjectGroupSummary {
  /** 未完成成员数（含其名下未完成子任务） */
  remaining: number;
  /** 已完成成员数，及它们名下的已完成子任务数 */
  doneCount: number;
  /** 近 RECENT_DONE_WINDOW_DAYS 天完成数（成员与子任务都算） */
  recentDoneCount: number;
  allDone: boolean;
  /** 被未完成前置挡住的可见成员数。对 group.tasks 求交：筛选裁剪自动跟着裁。 */
  blockedCount: number;
}

export function summarizeProjectGroup(group: TodoProjectGroup): ProjectGroupSummary {
  // 「还剩」= 看得见的未完成成员 + 它们名下未完成的子任务。按 group.tasks 求和而不是读一个
  // 加总好的标量：筛选激活时 tasks 已被裁剪，求和跟着裁，标题数字与展开后能数出来的条数一致。
  let pendingChildren = 0;
  let blockedCount = 0;
  for (const task of group.tasks) {
    pendingChildren += group.pendingChildByMember.get(task.id) ?? 0;
    // 「被挡」徽章同理按 group.tasks 求交：blockedByMember 是构造时的全集，
    // 筛选裁掉的行不在 tasks 里，计数跟着裁，徽章不会把看不见的成员算进去。
    if (group.blockedByMember.has(task.id)) blockedCount += 1;
  }
  const remaining = group.tasks.length + pendingChildren;
  return {
    remaining,
    doneCount: group.doneCount,
    recentDoneCount: group.recentDoneCount,
    blockedCount,
    // 无未完成成员 ⇒ pendingChildByMember 恒空，故此判据与旧行为等价。
    allDone: remaining === 0 && group.doneCount > 0,
  };
}

const MEMBER_SORT_RANK: Record<ProjectMemberState["kind"], number> = {
  "at-hand": 0,
  today: 1,
  idle: 2,
  scheduled: 3,
};

/**
 * 项目组内按「被挡的沉底 → 在手头 → 今天 → 躺着 → 已排期」排序，段内保持传入顺序。
 *
 * **沉底放在这里而不是组件里**：这是组内顺序的唯一真相，两个生产调用方（`listTasks` 与
 * `TodoProjectSection` 的 `displayProjectTasks`）都要拿到，只改一处会被另一处洗掉。
 * 它同时是「下一步」徽章的正确性来源——徽章读 `group.tasks[0]`，源头沉了底，徽章代码不必改。
 */
export function sortProjectMembers(
  tasks: readonly Task[],
  options: {
    handSessionId: string | null;
    now: Date;
    recentTaskIds?: readonly string[];
    /** 被未完成前置挡住的成员 id。缺省为空集时全部同档，与本参数存在之前逐字等价。 */
    blockedIds?: ReadonlySet<string>;
  },
): Task[] {
  const recentRank = new Map((options.recentTaskIds ?? []).map((id, index) => [id, index]));
  const blockedIds = options.blockedIds;
  return tasks
    .map((task, index) => ({ task, index, state: projectMemberState(task, options) }))
    .sort((a, b) => {
      // 被挡的一律沉底，且排在 MEMBER_SORT_RANK 之前判——「线以上全是能动的」这条承诺
      // 优先于「在手头的排最前」。被挡且在手头的成员因此也沉底（它仍正常显示在手头区）。
      const byBlocked =
        Number(blockedIds?.has(a.task.id) ?? false) - Number(blockedIds?.has(b.task.id) ?? false);
      if (byBlocked !== 0) return byBlocked;
      const byRank = MEMBER_SORT_RANK[a.state.kind] - MEMBER_SORT_RANK[b.state.kind];
      if (byRank !== 0) return byRank;
      if (a.state.kind === "scheduled" && b.state.kind === "scheduled") {
        const byDate = a.state.scheduledAt.localeCompare(b.state.scheduledAt);
        if (byDate !== 0) return byDate;
      }
      if (a.state.kind === "idle" && b.state.kind === "idle" && recentRank.size > 0) {
        const aRecent = recentRank.get(a.task.id) ?? Number.POSITIVE_INFINITY;
        const bRecent = recentRank.get(b.task.id) ?? Number.POSITIVE_INFINITY;
        const byRecent = aRecent - bRecent;
        if (byRecent !== 0) return byRecent;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.task);
}

export interface ProjectChip {
  goalId: string;
  goalTitle: string;
  /**
   * 该项目的身份色 `var(--color-tint-N)`，来自 `buckets.projectTints`。
   *
   * 由索引层带下来而不是让组件按 goalId 自己算：项目色是**集合内避撞分配**的结果
   * （见 `lib/contentTint.ts`），只有拿着全部 active project 才算得出，组件手上没有那份集合。
   */
  tint: string;
}

/**
 * taskId → 它所属的项目，供今天 / 已排期 / 手头三区渲染可点的项目名 chip。
 * 只索引未完成成员：已完成成员不在项目区显示集合里，chip 点过去也无处可展开。
 *
 * `tints` 查不到时留空串：组件对空串不画圆点（比画一个继承色的隐形点诚实）。
 * 正常不会发生——两者同源于 `listTasks` 的同一次 `db.goals` 读。
 */
export function projectChipIndex(
  groups: readonly TodoProjectGroup[],
  tints: ReadonlyMap<string, string>,
): Map<string, ProjectChip> {
  const index = new Map<string, ProjectChip>();
  for (const group of groups) {
    const tint = tints.get(group.goalId) ?? "";
    for (const task of group.tasks) {
      index.set(task.id, { goalId: group.goalId, goalTitle: group.goalTitle, tint });
    }
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

/**
 * 写入后的这条会不会落进项目区里那个**默认折叠的组**——落点反馈的唯一判据。三道闸缺一不可：
 *
 * 1. 项目区归集守卫（`parentId === null && recurrence === null && ruleId === null`）里 placement 判不出的两条：
 *    子任务 scheduledAt 为空照样被 placement 判成 inbox，而投影层只收根任务；ruleId 非空的混合体行
 *    被 recurrence 清成 null 后同理。这两种展开的都是不含它的组。
 *    （`done` 与 `recurrence` 不必单列：placement 首行就把 done 判成 completed、重复模板判成 today/recurring，
 *    两者永远进不了下面那个 inbox 分支——已完成成员待在组内**另一个**默认折叠的「已完成」子区里，
 *    展开组也看不到它，给的是错误指认、比零反馈更糟，正是靠这条挡住。）
 * 2. 焦点轴压过落点：listTasks 把未完成的手头成员截进 atHand 并 continue，它就在页面最顶上、本来就看得见，
 *    强行展开只会把页面滚走。
 * 3. 落点真的是 inbox 池：排到未来的成员回的是已排期区，同样本来就看得见。
 */
export function landsInCollapsedProjectGroup(
  task: Task,
  options: { handSessionId: string | null; now: Date },
): boolean {
  if ((task.parentId ?? null) !== null || task.ruleId !== null) return false;
  if (options.handSessionId !== null && (task.sessionId ?? null) === options.handSessionId) return false;
  return placementForTask(task, options.now).pool === "inbox";
}

export function isProjectDormant(args: {
  pendingTasks: readonly Task[];
  hasActiveTrack: boolean;
  settings: TodoGravitySettings;
  now: Date;
}): boolean {
  if (args.pendingTasks.length === 0) return false;
  if (args.hasActiveTrack) return false;
  for (const task of args.pendingTasks) {
    if (!isTaskSunken(task, args.settings, args.now)) return false;
  }
  return true;
}
