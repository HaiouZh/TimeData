import type { TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { addDays } from "../time.js";

export interface ClippedEntry {
  id: string;
  categoryId: string;
  note: string | null;
  startTime: string;
  endTime: string;
  clippedEnd: boolean;
}

// 本文件保持纯函数、模块图里不得出现 db —— 它的测试跑在 node 干净桶（零 DOM、零 db）。
// 碰 db 的当天窗口查询在 ./diaryRefEntriesQuery.ts。

/** 当天的 Asia/Shanghai 日界窗口（半开区间 [dayStart, dayEnd)）。查询与裁剪必须同源，否则边界条目一边查得出、一边被裁没。 */
export function diaryRefDayWindow(date: string): { dayStart: string; dayEnd: string } {
  return {
    dayStart: localDateTimeToUtc(`${date}T00:00:00`),
    dayEnd: localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`),
  };
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
