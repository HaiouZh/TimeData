import { addDays, getDateString, startOfWeek } from "../time.js";

export interface WeeklyDistributionPoint {
  weekStart: string;
  count: number;
}

export interface CompletionRatePoint {
  weekStart: string;
  created: number;
  completed: number;
}

/** 近 N 周（含今日所在周）的周起始（周一）序列，升序排列。 */
function recentWeekStarts(today: string, weeks: number): string[] {
  const currentWeekStart = startOfWeek(today);
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    starts.push(addDays(currentWeekStart, -7 * i));
  }
  return starts;
}

/** 按周聚合事件数量，近 N 周含空周补 0，周一为周首。 */
export function weeklyDistribution(events: string[], today: string, weeks: number): WeeklyDistributionPoint[] {
  const counts = new Map<string, number>();
  for (const iso of events) {
    const weekKey = startOfWeek(getDateString(new Date(iso)));
    counts.set(weekKey, (counts.get(weekKey) ?? 0) + 1);
  }
  return recentWeekStarts(today, weeks).map((weekStart) => ({
    weekStart,
    count: counts.get(weekStart) ?? 0,
  }));
}

/** 按周对齐创建/完成事件数（当期完成÷当期新建的原始分子分母，除法与"—"文案交给组件处理）。 */
export function completionRate(
  created: string[],
  completed: string[],
  today: string,
  weeks: number,
): CompletionRatePoint[] {
  const createdByWeek = weeklyDistribution(created, today, weeks);
  const completedByWeek = weeklyDistribution(completed, today, weeks);
  const completedMap = new Map(completedByWeek.map((point) => [point.weekStart, point.count]));
  return createdByWeek.map((point) => ({
    weekStart: point.weekStart,
    created: point.count,
    completed: completedMap.get(point.weekStart) ?? 0,
  }));
}
