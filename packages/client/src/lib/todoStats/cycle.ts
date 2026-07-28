import type { Task } from "@timedata/shared";
import { addDays, getDateString } from "../time.js";
import { completionEvents } from "./events.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type TurnaroundBucketLabel = "当天" | "1-3天" | "4-7天" | "8-30天" | ">30天";

const BUCKET_LABELS: TurnaroundBucketLabel[] = ["当天", "1-3天", "4-7天", "8-30天", ">30天"];

export interface CycleMetrics {
  medianTurnaroundDays: number | null;
  turnaroundBuckets: Array<{ label: string; count: number }>;
  avgCompletedPerDay: number;
  currentStreak: number;
  longestStreak: number;
}

function bucketForTurnaroundDays(days: number): TurnaroundBucketLabel {
  if (days < 1) return "当天";
  if (days <= 3) return "1-3天";
  if (days <= 7) return "4-7天";
  if (days <= 30) return "8-30天";
  return ">30天";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * ⑦周期指标：周转（中位数+分桶）、日均完成、连击天数。
 * 周转只对一次性任务(ruleId===null)有意义：occurrence 行的 createdAt 是系统物化时刻而非立 flag 时刻，排除。
 * streak 口径：连续有≥1完成事件的本地日历天；currentStreak 从今天回数，
 * 若今天尚无完成则从昨天起算不断（今天还没完成不打断昨天为止的连击）。
 */
export function cycleMetrics(tasks: Task[], today: string): CycleMetrics {
  const events = completionEvents(tasks);

  const turnaroundDays = events
    .filter((event) => event.task.ruleId === null)
    .map((event) => (new Date(event.completedAt).getTime() - new Date(event.task.createdAt).getTime()) / DAY_MS);

  const bucketCounts = new Map<TurnaroundBucketLabel, number>();
  for (const label of BUCKET_LABELS) bucketCounts.set(label, 0);
  for (const days of turnaroundDays) {
    const label = bucketForTurnaroundDays(days);
    bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
  }

  const completedDays = new Set(events.map((event) => getDateString(new Date(event.completedAt))));

  let avgCompletedPerDay = 0;
  if (events.length > 0) {
    const completedDates = events.map((event) => getDateString(new Date(event.completedAt))).sort();
    const firstDay = completedDates[0];
    // 含首尾日历天：today − firstDay + 1（恰好等于「首个完成事件就在今天」时的 1 天，不需要额外钳制）。
    const spanDays = (new Date(today).getTime() - new Date(firstDay).getTime()) / DAY_MS + 1;
    avgCompletedPerDay = events.length / spanDays;
  }

  let currentStreak = 0;
  const anchor = completedDays.has(today) ? today : addDays(today, -1);
  if (completedDays.has(anchor)) {
    let cursor = anchor;
    while (completedDays.has(cursor)) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    }
  }

  let longestStreak = 0;
  const visited = new Set<string>();
  for (const day of completedDays) {
    if (visited.has(day)) continue;
    // 只从每段连击的起点开始数，避免重复计算：起点即前一天不在集合中的日子。
    if (completedDays.has(addDays(day, -1))) continue;
    let run = 0;
    let cursor = day;
    while (completedDays.has(cursor)) {
      run += 1;
      visited.add(cursor);
      cursor = addDays(cursor, 1);
    }
    longestStreak = Math.max(longestStreak, run);
  }

  return {
    medianTurnaroundDays: median(turnaroundDays),
    turnaroundBuckets: BUCKET_LABELS.map((label) => ({ label, count: bucketCounts.get(label) ?? 0 })),
    avgCompletedPerDay,
    currentStreak,
    longestStreak,
  };
}
