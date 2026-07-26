import type { Task } from "@timedata/shared";
import { getDateString } from "../time.js";

/**
 * 「这天完成的待办」。硬性条件三条缺一不可：
 * - done === true：`listTasks` 的 completed 桶还装着账本判定耗尽的重复模板，模板 done 为 false，靠这条排除。
 * - completedAt !== null：绝不回退到 updatedAt（`groupCompletedByDay` 的 `completedAt ?? updatedAt` 正是误算来源）。
 * - 日界走 getDateString（Asia/Shanghai），不用待办自己的设备本地日界，否则非东八区设备上与打点/速记差一天。
 */
export function selectTasksCompletedOn(tasks: Task[], date: string): Task[] {
  return tasks
    .filter((t) => t.done && t.completedAt !== null && getDateString(new Date(t.completedAt)) === date)
    .sort((a, b) => (a.completedAt as string).localeCompare(b.completedAt as string));
}
