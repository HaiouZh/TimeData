import type { TimeEntry } from "@timedata/shared";
import { APP_TIME_ZONE, localDateTimeToUtc } from "@timedata/shared";

export { APP_TIME_ZONE } from "@timedata/shared";

export type TimeSlotDisplayMode = "default" | "merged" | "truncated";
export type TimeSlotKind = "entry" | "gap" | "future";

export interface TimeSlot {
  startTime: string;
  endTime: string;
  entry: TimeEntry | null;
  kind: TimeSlotKind;
  displayMode: TimeSlotDisplayMode;
}

export interface FormatDateTimeRangeOptions {
  mode?: "default" | "merged" | "truncated";
}

interface BuildTimeSlotsOptions {
  now?: Date | string;
  previousEntryEndTime?: string | null;
  previousEntry?: TimeEntry | null;
  mergeOvernight?: boolean;
}

const PREVIOUS_DAY_GAP_CONTINUATION_HOURS = 4;
const OVERNIGHT_ROLLBACK_THRESHOLD_MS = 12 * 60 * 60 * 1000;

function parseAppLocalDateTime(value: string): Date {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(value);
  }
  return new Date(`${value}+08:00`);
}

function datePartsInAppTimeZone(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format date in app time zone");
  }

  return { year, month, day };
}

/** 把任意时间字符串（本地格式或 UTC ISO）转为毫秒时间戳，用于正确比较混合格式。 */
function toMs(value: string): number {
  return parseAppLocalDateTime(value).getTime();
}

export function buildTimeSlots(
  entries: TimeEntry[],
  date: string,
  dayStartHour = 0,
  options: BuildTimeSlotsOptions = {},
): TimeSlot[] {
  const sorted = [...entries].sort((a, b) => toMs(a.startTime) - toMs(b.startTime));

  const dayStart = localDateTimeToUtc(`${date}T${String(dayStartHour).padStart(2, "0")}:00:00`);
  const nowValue = options.now || new Date();
  const now = typeof nowValue === "string" ? parseAppLocalDateTime(nowValue) : nowValue;
  const todayStr = getDateString(now);
  const dayEnd = date === todayStr ? now.toISOString() : localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`);

  const dayStartMs = toMs(dayStart);
  const dayEndMs = toMs(dayEnd);

  const slots: TimeSlot[] = [];
  const previousDayContinuationStart = localDateTimeToUtc(
    `${addDays(date, -1)}T${String(24 - PREVIOUS_DAY_GAP_CONTINUATION_HOURS).padStart(2, "0")}:00:00`,
  );
  const previousDayContinuationStartMs = toMs(previousDayContinuationStart);
  const mergeOvernight = options.mergeOvernight ?? true;
  const previousEntry = options.previousEntry || null;
  const previousEntryEndTime = options.previousEntryEndTime || previousEntry?.endTime || null;
  const shouldMergePreviousEntry = Boolean(
    mergeOvernight &&
      previousEntry &&
      toMs(previousEntry.startTime) < dayStartMs &&
      toMs(previousEntry.endTime) > dayStartMs &&
      toMs(previousEntry.endTime) <= dayEndMs,
  );

  if (shouldMergePreviousEntry && previousEntry) {
    slots.push({
      startTime: previousEntry.startTime,
      endTime: previousEntry.endTime,
      entry: previousEntry,
      kind: "entry",
      displayMode: "merged",
    });
  }

  // cursor 保持为字符串（slot 的边界），初始值为 dayStart（UTC）
  let cursor: string = dayStart;
  let cursorMs = dayStartMs;
  if (shouldMergePreviousEntry && previousEntry) {
    cursor = previousEntry.endTime;
    cursorMs = toMs(cursor);
  } else if (
    previousEntryEndTime &&
    toMs(previousEntryEndTime) >= previousDayContinuationStartMs &&
    toMs(previousEntryEndTime) < dayStartMs
  ) {
    cursor = previousEntryEndTime;
    cursorMs = toMs(cursor);
  }

  for (const entry of sorted) {
    if (shouldMergePreviousEntry && previousEntry && entry.id === previousEntry.id) continue;
    const entryEndMs = toMs(entry.endTime);
    const entryStartMs = toMs(entry.startTime);
    if (entryEndMs <= dayStartMs || entryStartMs >= dayEndMs) continue;

    const displayStart = entryStartMs < dayStartMs ? dayStart : entry.startTime;
    const displayStartMs = entryStartMs < dayStartMs ? dayStartMs : entryStartMs;
    const displayEnd = entryEndMs > dayEndMs ? dayEnd : entry.endTime;
    const displayEndMs = entryEndMs > dayEndMs ? dayEndMs : entryEndMs;
    if (displayEndMs <= displayStartMs) continue;

    if (displayStartMs > cursorMs) {
      slots.push({ startTime: cursor, endTime: displayStart, entry: null, kind: "gap", displayMode: "default" });
    }

    const displayMode: TimeSlotDisplayMode = entryEndMs > dayEndMs ? "truncated" : "default";
    slots.push({ startTime: displayStart, endTime: displayEnd, entry, kind: "entry", displayMode });
    if (displayEndMs > cursorMs) {
      cursor = displayEnd;
      cursorMs = displayEndMs;
    }
  }

  if (cursorMs < dayEndMs) {
    slots.push({ startTime: cursor, endTime: dayEnd, entry: null, kind: "gap", displayMode: "default" });
  }

  if (date === todayStr) {
    const trueDayEnd = localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`);
    if (toMs(trueDayEnd) > toMs(dayEnd)) {
      slots.push({
        startTime: dayEnd,
        endTime: trueDayEnd,
        entry: null,
        kind: "future",
        displayMode: "default",
      });
    }
  }

  return slots;
}

export function formatDateTimeRange(
  startTime: string,
  endTime: string,
  options: FormatDateTimeRangeOptions = {},
): string {
  const startLocal = toLocalDateTimeString(parseAppLocalDateTime(startTime));
  const endLocal = toLocalDateTimeString(parseAppLocalDateTime(endTime));
  const startDate = startLocal.slice(5, 10);
  const endDate = endLocal.slice(5, 10);
  const startClock = formatTime(startTime);
  const endClock = options.mode === "truncated" ? "24:00" : formatTime(endTime);

  if (options.mode === "merged" || options.mode === "truncated" || startLocal.slice(0, 10) === endLocal.slice(0, 10)) {
    return `${startClock} - ${endClock}`;
  }

  return `${startDate} ${startClock} - ${endDate} ${endClock}`;
}

export function formatTimelineTimeRange(
  startTime: string,
  endTime: string,
  options: FormatDateTimeRangeOptions = {},
): string {
  const startLocalDate = toLocalDateTimeString(parseAppLocalDateTime(startTime)).slice(0, 10);
  const endLocalDate = toLocalDateTimeString(parseAppLocalDateTime(endTime)).slice(0, 10);
  const startClock = formatTime(startTime);
  const endClock =
    options.mode === "truncated" || (startLocalDate !== endLocalDate && formatTime(endTime) === "00:00")
      ? "24:00"
      : formatTime(endTime);

  return `${startClock} - ${endClock}`;
}

export function formatTime(isoString: string): string {
  return toLocalDateTimeString(parseAppLocalDateTime(isoString)).slice(11, 16);
}

export function formatMinutesDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;

  if (hours === 0) return `${minutes}分钟`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

export function formatDuration(startTime: string, endTime: string): string {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  return formatMinutesDuration(ms / 60000);
}

/** 把 YYYY-MM-DD 渲染为「6月3日」这类去前导零的人性化标签。 */
export function formatMonthDay(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

/**
 * 任务标签专用：当年省略年份「6月3日」，跨年补年份前缀「2025年6月3日」。
 * now 仅用于注入当前时间做年份判定，默认取系统当前。
 */
export function formatYearAwareMonthDay(dateStr: string, now: Date = new Date()): string {
  const [yearStr, month, day] = dateStr.split("-");
  const year = Number(yearStr);
  const currentYear = Number(getDateString(now).slice(0, 4));
  if (year !== currentYear) return `${year}年${Number(month)}月${Number(day)}日`;
  return `${Number(month)}月${Number(day)}日`;
}

/**
 * 相对当前时间的人性化标签，供轨道步骤/卡片显示「最后动静多久前」。
 * <1 分钟→「刚刚」，<1 小时→「N分钟前」，<1 天→「N小时前」，<30 天→「N天前」，
 * 更早回退到年份感知的日期标签。未来时间（时钟偏差）钳为「刚刚」，非法输入原样返回。
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = now.getTime() - then;
  if (diffMs < 60_000) return "刚刚";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return formatYearAwareMonthDay(getDateString(new Date(then)), now);
}

export interface DaySummary {
  /** 已记录时长（分钟），不含 future。 */
  recordedMinutes: number;
  /** 空档时长（分钟），不含 future。 */
  gapMinutes: number;
  entryCount: number;
  gapCount: number;
  /** 已记录 / 已流逝（记录+空档）的占比，0..1；空白日为 0。 */
  coverageRatio: number;
}

/**
 * 从已构建的 slots 汇总当日概览；future 段不计入，使占比只反映已流逝时间。
 * 每个 slot 先钳到所选日期 [00:00, 次日00:00)，避免跨夜合并段（如昨晚 22:00 → 今早）
 * 把昨天那段也算进今天。
 */
export function summarizeDay(slots: TimeSlot[], date: string): DaySummary {
  const dayStartMs = toMs(localDateTimeToUtc(`${date}T00:00:00`));
  const dayEndMs = toMs(localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`));

  let recordedMinutes = 0;
  let gapMinutes = 0;
  let entryCount = 0;
  let gapCount = 0;

  for (const slot of slots) {
    if (slot.kind === "future") continue;
    const startMs = Math.max(dayStartMs, toMs(slot.startTime));
    const endMs = Math.min(dayEndMs, toMs(slot.endTime));
    const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    if (slot.kind === "entry") {
      recordedMinutes += minutes;
      entryCount += 1;
    } else if (slot.kind === "gap") {
      gapMinutes += minutes;
      gapCount += 1;
    }
  }

  const elapsed = recordedMinutes + gapMinutes;
  const coverageRatio = elapsed > 0 ? recordedMinutes / elapsed : 0;
  return { recordedMinutes, gapMinutes, entryCount, gapCount, coverageRatio };
}

export function getDateString(date: Date): string {
  const { year, month, day } = datePartsInAppTimeZone(date);
  return `${year}-${month}-${day}`;
}

export function toLocalDateTimeString(date: Date): string {
  const { year, month, day } = datePartsInAppTimeZone(date);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const hour = timeParts.find((part) => part.type === "hour")?.value;
  const minute = timeParts.find((part) => part.type === "minute")?.value;
  const second = timeParts.find((part) => part.type === "second")?.value;

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export function isFutureLocalDateTime(value: string, now: Date = new Date()): boolean {
  // value 可能是本地时间字符串或 UTC ISO 字符串，统一转为 Date 比较
  const valueDate = parseAppLocalDateTime(value);
  return valueDate > now;
}

export function formatAppDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;

  return `${toLocalDateTimeString(date).replace("T", " ")} UTC+8`;
}

// ?date= 查询参数的日历有效性校验：正则只挡格式，"2026-13-05" 会解析成 Invalid Date
// 崩掉 Intl.format，"2026-02-31" 会被 V8 静默滚动到 3 月 3 日——回构造比对拦掉两者。
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  return getDateString(parsed) === value;
}

export function formatWeekday(dateStr: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
  }).format(new Date(`${dateStr}T00:00:00+08:00`));
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return getDateString(d);
}

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

// 0 = 周一 ... 6 = 周日。用正午 +08:00 锚点 + APP_TIME_ZONE 格式化，避开偏移边界。
export function weekdayIndex(dateStr: string): number {
  const noon = new Date(`${dateStr}T12:00:00+08:00`);
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
  }).format(noon);
  const index = WEEKDAY_SHORT_TO_INDEX[short];
  if (index === undefined) throw new Error(`weekdayIndex: unexpected weekday token "${short}"`);
  return index;
}

export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -weekdayIndex(dateStr));
}

// 月份偏移，日溢出钳制到目标月最后一天（如 1/31 + 1 月 → 2/28）。
export function addMonths(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12 + 1; // 1-based
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

export interface ResolvedClockRange {
  startTime: string;
  endTime: string;
}

/**
 * 时:分轮选器锚定到今天时，凌晨补记昨晚会被解析成今天深夜的未来。
 * end 比 now 超前超过 12 小时视为昨晚同一时钟时间；更近的未来保留给上层拦截。
 */
export function rollBackOvernightRange(
  startTime: string,
  endTime: string,
  now: Date = new Date(),
): ResolvedClockRange {
  const aheadMs = parseAppLocalDateTime(endTime).getTime() - now.getTime();
  if (aheadMs <= OVERNIGHT_ROLLBACK_THRESHOLD_MS) return { startTime, endTime };

  const shift = (local: string) => `${addDays(local.slice(0, 10), -1)}${local.slice(10)}`;
  return { startTime: shift(startTime), endTime: shift(endTime) };
}

export function resolveClockRangeAroundEndDate(
  anchorDate: string,
  startHour: string,
  startMinute: string,
  endHour: string,
  endMinute: string,
): ResolvedClockRange {
  // 24:00 是锚定日的一天终点；按 [start, end) 落库为次日 00:00。
  if (endHour === "24") {
    return {
      startTime: `${anchorDate}T${startHour}:${startMinute}:00`,
      endTime: `${addDays(anchorDate, 1)}T00:00:00`,
    };
  }

  const startClock = `${startHour}:${startMinute}`;
  const endClock = `${endHour}:${endMinute}`;
  const startDate = endClock <= startClock ? addDays(anchorDate, -1) : anchorDate;
  return {
    startTime: `${startDate}T${startClock}:00`,
    endTime: `${anchorDate}T${endClock}:00`,
  };
}
