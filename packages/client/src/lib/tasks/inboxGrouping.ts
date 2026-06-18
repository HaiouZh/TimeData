import type { Task } from "@timedata/shared";
import { formatMonthDay, getDateString } from "../time.js";

export interface InboxDaySegment {
  key: string;
  label: string;
  tasks: Task[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 按 pickIso 提取的日期把任务分组到本地日段，最新日在前，段内按 pickIso 倒序。 */
export function groupByDay(
  tasks: Task[],
  pickIso: (t: Task) => string,
  now: Date = new Date(),
): InboxDaySegment[] {
  const todayStr = getDateString(now);
  const yesterdayStr = getDateString(new Date(now.getTime() - DAY_MS));
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    const day = getDateString(new Date(pickIso(t)));
    const list = byDay.get(day) ?? [];
    list.push(t);
    byDay.set(day, list);
  }
  return [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => ({
      key: day,
      label: day === todayStr ? "今天" : day === yesterdayStr ? "昨天" : formatMonthDay(day),
      tasks: (byDay.get(day) ?? []).sort((a, b) => pickIso(b).localeCompare(pickIso(a))),
    }));
}

export function groupInboxByDay(tasks: Task[], now: Date = new Date()): InboxDaySegment[] {
  return groupByDay(tasks, (t) => t.createdAt, now);
}

export function groupCompletedByDay(tasks: Task[], now: Date = new Date()): InboxDaySegment[] {
  return groupByDay(tasks, (t) => t.completedAt ?? t.updatedAt, now);
}