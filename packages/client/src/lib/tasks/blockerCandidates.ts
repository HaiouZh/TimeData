import type { Task, Track } from "@timedata/shared";
import { isOccurrenceChildId } from "./occurrenceChildId.js";

function matchesQuery(title: string, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  return title.toLowerCase().includes(trimmed.toLowerCase());
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 候选行的「什么时候」：自己排了期就用自己的，没有就往上取父一层。
 *
 * **往上取父这一层是给重复发次的子步骤用的**：`materializeOccurrenceChildren` 克隆出来的子步骤
 * `scheduledAt` 恒为 null、`ruleId` 也是 null（所以两道重复过滤都拦不住它们），日期只挂在父发次上。
 * 不取父的日期，一条每日习惯攒下的几十条同名子步骤在候选里就是一模一样的行，既分不清是哪天的，
 * 也没法按时间沉底——它们的 updatedAt 恰好都很新，正好霸占列表最前面。
 */
export function blockerCandidateDate(task: Task, taskById: ReadonlyMap<string, Task>): Date | null {
  const own = parseDate(task.scheduledAt);
  if (own !== null) return own;
  const parentId = task.parentId ?? null;
  if (parentId === null) return null;
  return parseDate(taskById.get(parentId)?.scheduledAt ?? null);
}

export function filterBlockerCandidates(args: {
  tasks: readonly Task[];
  tracks: readonly Track[];
  selfTaskId: string;
  existingBlockerKeys: ReadonlySet<string>;
  query: string;
}): { tasks: Task[]; tracks: Track[] } {
  // 取父的排期要查全量表（父自己可能因 ruleId 非空而不是候选），所以索引建在过滤之前。
  const taskById = new Map(args.tasks.map((task) => [task.id, task] as const));
  const tasks = args.tasks
    .filter(
      (task) =>
        !task.done &&
        task.id !== args.selfTaskId &&
        !args.existingBlockerKeys.has(`task:${task.id}`) &&
        (task.ruleId ?? null) === null &&
        (task.recurrence ?? null) === null &&
        // 重复发次的镜像子步骤不进候选：它们由 materializeOccurrenceChildren 每天克隆一份，
        // recurrence/ruleId 都写 null，上面两道重复过滤拦不住，攒起来能淹掉整屏候选。
        // 判据与 todoStats 的 creationEvents 同源——那边同样用它把这类行剔出「用户创建的任务」。
        // 把「今天那一发的某个子步骤」设成前置本来也没意义：明天换新的一份，边就指向历史残骸。
        !isOccurrenceChildId(task.id) &&
        matchesQuery(task.title, args.query),
    )
    // 带时间的整体沉底：一次性的「哪天该干的活」和习惯发次的子步骤都归到列表末尾，
    // 前面留给无排期的活。组内按日期倒序（近的在前），同日再退回 updatedAt 倒序。
    .sort((a, b) => {
      const dateA = blockerCandidateDate(a, taskById);
      const dateB = blockerCandidateDate(b, taskById);
      if ((dateA === null) !== (dateB === null)) return dateA === null ? -1 : 1;
      if (dateA !== null && dateB !== null) {
        const byDate = dateB.getTime() - dateA.getTime();
        if (byDate !== 0) return byDate;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const tracks = args.tracks.filter(
    (track) =>
      track.status === "active" &&
      !args.existingBlockerKeys.has(`track:${track.id}`) &&
      matchesQuery(track.title, args.query),
  );

  return { tasks, tracks };
}

/**
 * 候选行右侧那列上下文：`归属 · M月d日`。
 *
 * 归属取项目名，没有就取父任务标题；日期见 `blockerCandidateDate`。两者都缺才返回 null
 * （调用方据此不渲染右列）。日期与排序读同一个函数——显示与沉底必须同源，否则会出现
 * 「列表写着 8 月 20 日、却排在无日期那一堆里」。
 */
export function blockerCandidateContext(
  task: Task,
  ctx: {
    projectNameByTaskId: ReadonlyMap<string, string>;
    taskById: ReadonlyMap<string, Task>;
  },
): string | null {
  const date = blockerCandidateDate(task, ctx.taskById);
  const dateLabel = date === null ? null : `${date.getMonth() + 1}月${date.getDate()}日`;
  const parentId = task.parentId ?? null;
  const owner =
    ctx.projectNameByTaskId.get(task.id) ?? (parentId === null ? undefined : ctx.taskById.get(parentId)?.title);
  if (owner === undefined) return dateLabel;
  return dateLabel === null ? owner : `${owner} · ${dateLabel}`;
}
