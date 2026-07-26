import type { TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { addDays } from "../time.js";

export interface ClippedEntry {
  id: string;
  categoryId: string;
  note: string | null;
  startTime: string;
  endTime: string;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * 打点按区间重叠查出，跨零点条目会同时落在两天。这里按 Asia/Shanghai 日界把每条裁到
 * 当天窗口内——不裁的话「23:00–次日01:00」会在今天显示成两小时，两天各显示一次同样的时长。
 */
export function clipEntriesToDay(entries: TimeEntry[], date: string): ClippedEntry[] {
  const dayStart = localDateTimeToUtc(`${date}T00:00:00`);
  const dayEnd = localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`);

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
      clippedStart: startTime !== e.startTime,
      clippedEnd: endTime !== e.endTime,
    });
  }
  return clipped.sort((a, b) => a.startTime.localeCompare(b.startTime));
}
