import type { Recurrence } from "@timedata/shared";

const DAY_MS = 86_400_000;

/** 把 ISO/Date 归一到当地"日序号"（以 1970-01-01 当地零点为基的整数天）。 */
function localDayIndex(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / DAY_MS);
}
function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 返回 ≤ now 的最近一次计划发生"日序号"，无则 null。 */
function lastScheduledDay(r: Recurrence, startAt: Date, now: Date): number | null {
  const startDay = localDayIndex(startAt);
  const nowDay = localDayIndex(now);
  if (nowDay < startDay) return null;
  if (r.freq === "daily") {
    const k = Math.floor((nowDay - startDay) / r.interval);
    return startDay + k * r.interval;
  }
  if (r.freq === "weekly") {
    const days = r.byWeekday ?? [];
    const startWeek = localWeekIndex(startDay);
    const weekOk = (localWeekIndex(nowDay) - startWeek) % r.interval === 0;
    if (weekOk && days.includes(localWeekday(nowDay))) return nowDay;
    return null;
  }
  return null;
}

/** ISO 周几：周一=1 … 周日=7（基于当地日序号）。 */
function localWeekday(dayIndex: number): number {
  return ((dayIndex % 7) + 7 + 3) % 7 + 1;
}
/** 当地"周序号"（以周一为周首，基于日序号）。 */
function localWeekIndex(dayIndex: number): number {
  return Math.floor((dayIndex - (localWeekday(dayIndex) - 1)) / 7);
}

/** 给定 after（completion 基准用），求严格晚于它的下一发生日序号。 */
function nextScheduledDayAfter(r: Recurrence, startAt: Date, after: Date): number {
  const afterDay = localDayIndex(after);
  if (r.freq === "daily") return afterDay + r.interval;
  if (r.freq === "weekly") {
    const days = r.byWeekday ?? [];
    const startWeek = localWeekIndex(localDayIndex(startAt));
    for (let d = afterDay + 1; d < afterDay + 1 + 7 * r.interval + 7; d++) {
      const weekOk = (localWeekIndex(d) - startWeek) % r.interval === 0;
      if (weekOk && days.includes(localWeekday(d))) return d;
    }
    return afterDay + 7 * r.interval;
  }
  return afterDay + 1;
}

export function isDueNow(
  recurrence: Recurrence,
  lastDoneAt: string | null,
  startAt: string | Date | null,
  now: string | Date = new Date(),
): boolean {
  const nowDate = toDate(now);
  const start = startAt ? toDate(startAt) : nowDate;
  const nowDay = localDayIndex(nowDate);

  if (recurrence.basis === "completion") {
    if (!lastDoneAt) return localDayIndex(start) <= nowDay;
    return nextScheduledDayAfter(recurrence, start, toDate(lastDoneAt)) <= nowDay;
  }
  const last = lastScheduledDay(recurrence, start, nowDate);
  if (last === null) return false;
  if (!lastDoneAt) return true;
  return localDayIndex(toDate(lastDoneAt)) < last;
}
