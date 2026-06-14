import type { Task } from "@timedata/shared";
import { isDueNow, currentDueDayFor } from "./recurrence.js";

export type TodoPlacement =
  | { pool: "today"; overdue: boolean }
  | { pool: "inbox" }
  | { pool: "upcoming" }
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

/** 计算任务应放置的分区。 */
export function placementForTask(task: Task, now: Date): TodoPlacement {
  if (task.done) return { pool: "completed" };

  if (task.recurrence) {
    const due = isDueNow(task.recurrence, task.lastDoneAt, task.startAt, now);
    if (due) {
      const dueDay = currentDueDay(task, now);
      return { pool: "today", overdue: dueDay < localDayIndex(now) };
    }
    return { pool: "upcoming" };
  }

  if (task.scheduledAt === null) return { pool: "inbox" };
  const schedDay = localDayIndex(new Date(task.scheduledAt));
  const nowDay = localDayIndex(now);
  if (schedDay > nowDay) return { pool: "upcoming" };
  return { pool: "today", overdue: schedDay < nowDay };
}
