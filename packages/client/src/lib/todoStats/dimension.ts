import type { Goal, Task } from "@timedata/shared";

const UNTAGGED_LABEL = "未打标签";
const TAG_TOP_N = 10;

export interface TagBreakdownRow {
  tag: string;
  open: number;
  done: number;
}

export interface ProjectBreakdownRow {
  goalId: string;
  title: string;
  open: number;
  done: number;
}

/**
 * 按标签统计 open/done 计数。一任务多标签各计一次；无标签的任务归入「未打标签」桶。
 * 按 open+done 降序，取前 10。
 */
export function tagBreakdown(tasks: Task[]): TagBreakdownRow[] {
  const counts = new Map<string, { open: number; done: number }>();
  for (const task of tasks) {
    const tags = task.tags.length > 0 ? task.tags : [UNTAGGED_LABEL];
    for (const tag of tags) {
      const entry = counts.get(tag) ?? { open: 0, done: 0 };
      if (task.done) entry.done += 1;
      else entry.open += 1;
      counts.set(tag, entry);
    }
  }
  return [...counts.entries()]
    .map(([tag, { open, done }]) => ({ tag, open, done }))
    .sort((a, b) => b.open + b.done - (a.open + a.done))
    .slice(0, TAG_TOP_N);
}

/**
 * 按项目维度统计 open/done 计数。只认 status==="active" 且 kind==="project" 的 goal 的 task 成员，
 * 独立实现（不 import projectMemberIndex），同一口径：仅 kind==="project" 且 status==="active"。
 */
export function projectBreakdown(tasks: Task[], goals: Goal[]): ProjectBreakdownRow[] {
  const taskById = new Map<string, Task>();
  for (const task of tasks) taskById.set(task.id, task);

  const rows: ProjectBreakdownRow[] = [];
  for (const goal of goals) {
    if (goal.status !== "active" || goal.kind !== "project") continue;
    let open = 0;
    let done = 0;
    for (const member of goal.members ?? []) {
      if (member.kind !== "task") continue;
      const task = taskById.get(member.id);
      if (!task) continue;
      if (task.done) done += 1;
      else open += 1;
    }
    rows.push({ goalId: goal.id, title: goal.title, open, done });
  }
  return rows;
}
