import type { Task } from "@timedata/shared";
import { isDueNow, currentDueDayFor } from "./recurrence.js";

export type TodoPlacement =
  | { pool: "today"; overdue: boolean }
  | { pool: "inbox" }
  | { pool: "upcoming" }
  | { pool: "recurring" }
  | { pool: "completed" };

const DAY_MS = 86_400_000;

function localDayIndex(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / DAY_MS);
}

/** 把 Date 转为本地零点对应的 UTC ISO 字符串。 */
export function localDateOf(d: Date): string {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString();
}

/** 把 "YYYY-MM-DD" 格式字符串转为本地零点 UTC ISO。 */
export function normalizeScheduledDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDateOf(new Date(y, m - 1, d));
}

/** 获取重复任务当前到期日序号。 */
export function currentDueDay(task: Task, now: Date): number {
  if (!task.recurrence) return localDayIndex(now);
  return currentDueDayFor(task.recurrence, task.lastDoneAt, task.startAt, now);
}

/** 重复任务是否已耗尽（count 满 / until 过且无到期），供落点兜底到「完成」。 */
export function isExhausted(task: Task, now: Date): boolean {
  const r = task.recurrence;
  if (!r) return false;
  if (r.count != null && (task.completedCount ?? 0) >= r.count) return true;
  if (r.until != null) {
    const untilDay = localDayIndex(new Date(r.until));
    const nowDay = localDayIndex(now);
    const dueDay = currentDueDay(task, now);
    if (untilDay < nowDay && dueDay > untilDay && !isDueNow(r, task.lastDoneAt, task.startAt, now)) return true;
  }
  return false;
}

/** 计算任务应放置的分区。 */
export function placementForTask(task: Task, now: Date): TodoPlacement {
  if (task.done) return { pool: "completed" };

  if (task.recurrence) {
    if (isExhausted(task, now)) return { pool: "completed" };
    const due = isDueNow(task.recurrence, task.lastDoneAt, task.startAt, now);
    const dueDay = currentDueDay(task, now);
    const untilDay = task.recurrence.until != null ? localDayIndex(new Date(task.recurrence.until)) : Number.POSITIVE_INFINITY;
    const hasOutstandingUntilOccurrence = task.recurrence.until != null && dueDay <= untilDay && untilDay < localDayIndex(now);
    if (due || hasOutstandingUntilOccurrence) {
      return { pool: "today", overdue: dueDay < localDayIndex(now) };
    }
    // 未到期的重复任务只在「重复 / 提醒」区管理，不再与「即将到来」重复显示。
    return { pool: "recurring" };
  }

  if (task.scheduledAt === null) return { pool: "inbox" };
  const schedDay = localDayIndex(new Date(task.scheduledAt));
  const nowDay = localDayIndex(now);
  if (schedDay > nowDay) return { pool: "upcoming" };
  if (schedDay < nowDay) return { pool: "inbox" }; // 非重复待办过期不堆在今天，回归收件箱
  return { pool: "today", overdue: false };
}
