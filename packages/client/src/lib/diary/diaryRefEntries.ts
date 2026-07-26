import type { TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { db } from "../../db/index.js";
import { addDays } from "../time.js";

export interface ClippedEntry {
  id: string;
  categoryId: string;
  note: string | null;
  startTime: string;
  endTime: string;
  clippedEnd: boolean;
}

/** 当天的 Asia/Shanghai 日界窗口（半开区间 [dayStart, dayEnd)）。查询与裁剪必须同源，否则边界条目一边查得出、一边被裁没。 */
export function diaryRefDayWindow(date: string): { dayStart: string; dayEnd: string } {
  return {
    dayStart: localDateTimeToUtc(`${date}T00:00:00`),
    dayEnd: localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`),
  };
}

/**
 * 参考栏打点块专用的当天窗口查询。**不复用 `useEntries(date)`**：那个 hook 内部还有第二条
 * `previousEntry` 的近全表扫描（`where("startTime").below(now)`），本块一个字段都不用，
 * 每次挂载/切日期却要白付一倍读取；它还把「查询未回」的 `undefined` 兜底成 `[]`，
 * 会让本块在加载中把空态文案当事实说出来。
 */
export async function listEntriesOverlappingDay(date: string): Promise<TimeEntry[]> {
  const { dayStart, dayEnd } = diaryRefDayWindow(date);
  const candidates = await db.timeEntries.where("startTime").below(dayEnd).toArray();
  return candidates.filter((entry) => entry.endTime > dayStart);
}

/**
 * 打点按区间重叠查出，跨零点条目会同时落在两天。这里按 Asia/Shanghai 日界把每条裁到
 * 当天窗口内——不裁的话「23:00–次日01:00」会在今天显示成两小时，两天各显示一次同样的时长。
 */
export function clipEntriesToDay(entries: TimeEntry[], date: string): ClippedEntry[] {
  const { dayStart, dayEnd } = diaryRefDayWindow(date);

  const clipped: ClippedEntry[] = [];
  for (const e of entries) {
    const startTime = e.startTime < dayStart ? dayStart : e.startTime;
    const endTime = e.endTime > dayEnd ? dayEnd : e.endTime;
    if (startTime >= endTime) continue;
    clipped.push({
      id: e.id,
      categoryId: e.categoryId,
      note: e.note,
      startTime,
      endTime,
      clippedEnd: endTime !== e.endTime,
    });
  }
  return clipped.sort((a, b) => a.startTime.localeCompare(b.startTime));
}
