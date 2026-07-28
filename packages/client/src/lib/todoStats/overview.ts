import type { Task } from "@timedata/shared";
import type { TodoBuckets } from "../tasks.js";
import { placementForTask } from "../tasks/placement.js";

export interface TodoOverview {
  total: number;
  open: number;
  doneTotal: number;
  byBucket: { today: number; inbox: number; scheduled: number; projects: number };
  recurringRules: number;
  overdue: number;
  noSchedule: number;
}

/** 总览数字墙:各桶计数、完成/未完成、重复规则数、逾期数(复用 placementForTask 的 overdue 判定)、无排期数(=inbox 条数)。 */
export function buildTodoOverview(buckets: TodoBuckets, tasks: Task[], now: Date): TodoOverview {
  const doneTotal = tasks.filter((t) => t.done).length;
  const total = tasks.length;
  const projects = buckets.projects.reduce((sum, group) => sum + group.tasks.length, 0);
  const recurringRules = tasks.filter((t) => t.recurrence !== null && (t.parentId ?? null) === null).length;
  const overdue = [...buckets.today].filter((t) => {
    const p = placementForTask(t, now);
    return p.pool === "today" && p.overdue;
  }).length;

  return {
    total,
    open: total - doneTotal,
    doneTotal,
    byBucket: {
      today: buckets.today.length,
      inbox: buckets.inbox.length,
      scheduled: buckets.scheduled.length,
      projects,
    },
    recurringRules,
    overdue,
    noSchedule: buckets.inbox.length,
  };
}
