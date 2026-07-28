import type { Task } from "@timedata/shared";
import type { TodoBuckets } from "../tasks.js";
import { placementForTask } from "../tasks/placement.js";
import { getDateString } from "../time.js";
import { completionEvents } from "./events.js";

export interface TodoOverview {
  total: number;
  open: number;
  doneTotal: number;
  byBucket: { today: number; inbox: number; scheduled: number; projects: number };
  recurringRules: number;
  overdue: number;
  noSchedule: number;
}

/**
 * 总览数字墙:各桶计数、完成/未完成、重复规则数、无排期数、逾期数。
 * doneTotal 与完成分布/热力图/周期指标同源,走 completionEvents(排除耗尽重复模板行)。
 * overdue = today 桶里 placementForTask 判定的 overdue(重复/occurrence 追平项) 并集
 *   一次性过期任务(recurrence===null && ruleId===null && parentId===null && scheduledAt!==null 且本地日 < today,
 *   这类任务按 placement.ts 的产品设计回流 inbox,不带 overdue 标志,需在统计口径里单独补计)。
 * noSchedule 直数 scheduledAt===null 的未完成根任务,不再等同 inbox.length(inbox 还混了上面回流的过期任务)。
 */
export function buildTodoOverview(buckets: TodoBuckets, tasks: Task[], now: Date): TodoOverview {
  const doneTotal = completionEvents(tasks).length;
  const total = tasks.length;
  const projects = buckets.projects.reduce((sum, group) => sum + group.tasks.length, 0);
  const recurringRules = tasks.filter((t) => t.recurrence !== null && (t.parentId ?? null) === null).length;

  const todayLocal = getDateString(now);
  const overdueFromBuckets = [...buckets.today].filter((t) => {
    const p = placementForTask(t, now);
    return p.pool === "today" && p.overdue;
  }).length;
  const overdueOneOff = tasks.filter((t) => {
    if (t.done) return false;
    if (t.recurrence !== null) return false;
    if (t.ruleId !== null) return false;
    if ((t.parentId ?? null) !== null) return false;
    if (t.scheduledAt === null) return false;
    return getDateString(new Date(t.scheduledAt)) < todayLocal;
  }).length;
  const overdue = overdueFromBuckets + overdueOneOff;

  const noSchedule = tasks.filter(
    (t) => !t.done && t.scheduledAt === null && (t.parentId ?? null) === null,
  ).length;

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
    noSchedule,
  };
}
