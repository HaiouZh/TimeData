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

export function formatDuration(startTime: string, endTime: string): string {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}分钟`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
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
  return WEEKDAY_SHORT_TO_INDEX[short] ?? 0;
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

export function resolveClockRangeAroundEndDate(
  anchorDate: string,
  startHour: string,
  startMinute: string,
  endHour: string,
  endMinute: string,
): ResolvedClockRange {
  const startClock = `${startHour}:${startMinute}`;
  const endClock = `${endHour}:${endMinute}`;
  const startDate = endClock <= startClock ? addDays(anchorDate, -1) : anchorDate;
  return {
    startTime: `${startDate}T${startClock}:00`,
    endTime: `${anchorDate}T${endClock}:00`,
  };
}
