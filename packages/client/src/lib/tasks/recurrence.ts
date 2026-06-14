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
    for (let d = nowDay; d >= startDay; d--) {
      const weekOk = (localWeekIndex(d) - startWeek) % r.interval === 0;
      if (weekOk && days.includes(localWeekday(d))) return d;
    }
    return null;
  }
  if (r.freq === "monthly") {
    const s = dayToLocalYmd(startDay);
    const startMonth = monthIndex(s.y, s.m);
    for (let d = nowDay; d >= startDay; d--) {
      const ymd = dayToLocalYmd(d);
      if ((monthIndex(ymd.y, ymd.m) - startMonth) % r.interval !== 0) continue;
      if (monthlyHitDays(ymd.y, ymd.m, r.byMonthday ?? []).includes(d)) return d;
    }
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

function dayToLocalYmd(dayIndex: number): { y: number; m: number; d: number } {
  const ms = dayIndex * DAY_MS + new Date(dayIndex * DAY_MS).getTimezoneOffset() * 60_000;
  const dt = new Date(ms);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}
function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
/** 该年月里 byMonthday 命中的当地日序号集合（-1=月末；不存在的号跳过）。 */
function monthlyHitDays(y: number, m: number, byMonthday: number[]): number[] {
  const last = lastDayOfMonth(y, m);
  const out: number[] = [];
  for (const md of byMonthday) {
    const day = md === -1 ? last : md;
    if (day >= 1 && day <= last) out.push(localDayIndex(new Date(y, m - 1, day, 12)));
  }
  return out;
}
function monthIndex(y: number, m: number): number {
  return y * 12 + (m - 1);
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
  if (r.freq === "monthly") {
    const s = dayToLocalYmd(localDayIndex(startAt));
    for (let d = afterDay + 1; d < afterDay + 1 + 400; d++) {
      const ymd = dayToLocalYmd(d);
      if ((monthIndex(ymd.y, ymd.m) - monthIndex(s.y, s.m)) % r.interval !== 0) continue;
      if (monthlyHitDays(ymd.y, ymd.m, r.byMonthday ?? []).includes(d)) return d;
    }
    return afterDay + 30;
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

export function recurrenceSummary(r: Recurrence): string {
  const time = r.time ? ` ${r.time}` : "";
  if (r.freq === "daily") return `${r.interval === 1 ? "每天" : `每${r.interval}天`}${time}`;
  if (r.freq === "weekly") {
    const labels = ["一", "二", "三", "四", "五", "六", "日"];
    const days = (r.byWeekday ?? []).map((day) => `周${labels[day - 1]}`).join("");
    return `${r.interval === 1 ? "每周" : `每${r.interval}周`}${days}${time}`;
  }
  const monthdays = (r.byMonthday ?? [])
    .map((day) => (day === -1 ? "最后一天" : `${day}号`))
    .join("、");
  return `${r.interval === 1 ? "每月" : `每${r.interval}月`}${monthdays}${time}`;
}

/** 本地"创建于 MM-DD"。 */
export function formatCreatedAt(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `创建于 ${mm}-${dd}`;
}

/** 当前到期日序号：无 lastDoneAt → startDay；有 → lastDoneAt 后的下一应发生日。供 overdue 判定。 */
export function currentDueDayFor(r: Recurrence, lastDoneAt: string | null, startAt: string | Date | null, now: string | Date = new Date()): number {
  const nowDate = toDate(now);
  const start = startAt ? toDate(startAt) : nowDate;
  if (!lastDoneAt) return localDayIndex(start);
  return nextScheduledDayAfter(r, start, toDate(lastDoneAt));
}
