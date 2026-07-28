import type { Task } from "@timedata/shared";
import { isOccurrenceChildId } from "../tasks/occurrenceChildId.js";
import { getDateString, startOfWeek } from "../time.js";

/** 完成事件:completedAt≠null 且非重复模板行(recurrence===null),防模板与 occurrence 双计。 */
export function completionEvents(tasks: Task[]): Array<{ task: Task; completedAt: string }> {
  const events: Array<{ task: Task; completedAt: string }> = [];
  for (const task of tasks) {
    if (task.completedAt === null) continue;
    if (task.recurrence !== null) continue;
    events.push({ task, completedAt: task.completedAt });
  }
  return events;
}

/**
 * 创建事件:ruleId===null(occurrence 物化行不算创建),
 * 且排除 occurrence 子任务克隆行(id 形如 `{occurrenceId}:child:{templateChildId}`,
 * 由 materializeOccurrenceChildren 系统物化写入,不是用户创建的一次性任务)。
 */
export function creationEvents(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.ruleId === null && !isOccurrenceChildId(task.id));
}

/** 按 APP_TIME_ZONE 日归属分桶。 */
export function countByDay(isoTimestamps: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const iso of isoTimestamps) {
    const dayKey = getDateString(new Date(iso));
    map.set(dayKey, (map.get(dayKey) ?? 0) + 1);
  }
  return map;
}

export function countByWeek(isoTimestamps: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const iso of isoTimestamps) {
    const dayKey = getDateString(new Date(iso));
    const weekKey = startOfWeek(dayKey);
    map.set(weekKey, (map.get(weekKey) ?? 0) + 1);
  }
  return map;
}
