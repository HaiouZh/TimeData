import type { Task } from "@timedata/shared";
import { isDueNow, currentDueDayFor } from "./recurrence.js";

export { localDateOf, localDateString, normalizeScheduledDate } from "@timedata/shared";

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

/** 获取重复任务当前到期日序号。 */
export function currentDueDay(task: Task, now: Date): number {
  if (!task.recurrence) return localDayIndex(now);
  return currentDueDayFor(task.recurrence, task.lastDoneAt, task.startAt, now);
}

/**
 * 重复任务的 **until 腿**是否已耗尽（until 过且无到期），供落点兜底到「完成」。
 *
 * **权威判定是 `isRuleExhausted`（读 occurrence 账本），不是这里**：`listTasks` 对重复模板
 * 一律走账本，走不到本函数。本函数只服务拿不到账本的调用方（projectZone / todoStats /
 * 目标候选），是个降级近似。
 *
 * 故意不看 `completedCount`：该字段全仓只有置 0 路径、没有递增路径（`occurrence.ts` /
 * `agent.ts` / `taskCompletion.ts` 都写 0），曾经的 count 腿 `completedCount >= r.count`
 * 对真实数据恒 false，留着只会让人以为 count 在这里生效。count 配额由账本条数判定。
 */
export function isExhausted(task: Task, now: Date): boolean {
  const r = task.recurrence;
  if (!r) return false;
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

  // occurrence（ruleId 非空、recurrence 已在上面 null）：逾期落 today 红追平，不回 inbox。
  if (task.ruleId !== null) {
    const schedDay = localDayIndex(new Date(task.scheduledAt));
    const nowDay = localDayIndex(now);
    if (schedDay > nowDay) return { pool: "upcoming" };
    return { pool: "today", overdue: schedDay < nowDay };
  }

  const schedDay = localDayIndex(new Date(task.scheduledAt));
  const nowDay = localDayIndex(now);
  if (schedDay > nowDay) return { pool: "upcoming" };
  if (schedDay < nowDay) return { pool: "inbox" }; // 非重复待办过期不堆在今天，回归收件箱
  return { pool: "today", overdue: false };
}
