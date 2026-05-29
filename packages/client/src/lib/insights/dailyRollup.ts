import type { Category, TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { addDays } from "../time.ts";
import { resolveParentId } from "./sessions.js";
import type { DailyRollup, DaySegment } from "./types.js";

const toMs = (iso: string) => new Date(iso).getTime();

// 列出 [fromDate, toDate] 之间的本地日期串（含端点）。
function listDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate;
  // 防御：最多 400 天，避免异常输入死循环。
  for (let i = 0; i < 400 && cursor <= toDate; i++) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

// 把条目按本地午夜边界切分到各日，产出每个本地日的预聚合。
// C1：跨天条目必须按日界裁剪，否则单日时长会 > 24h。
export function buildDailyRollups(
  entries: TimeEntry[],
  categories: Category[],
  fromDate: string,
  toDate: string,
): DailyRollup[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const dates = listDates(fromDate, toDate);

  const rollups: DailyRollup[] = dates.map((date) => ({
    date,
    totalMin: 0,
    byParent: {},
    segments: [],
    firstActivity: null,
    lastActivity: null,
  }));
  const rollupByDate = new Map(rollups.map((r) => [r.date, r]));

  for (const entry of entries) {
    const entryStartMs = toMs(entry.startTime);
    const entryEndMs = toMs(entry.endTime);
    if (!Number.isFinite(entryStartMs) || !Number.isFinite(entryEndMs) || entryEndMs <= entryStartMs) continue;
    const parentId = resolveParentId(entry, categoryById);

    for (const date of dates) {
      const dayStartMs = toMs(localDateTimeToUtc(`${date}T00:00:00`));
      const dayEndMs = toMs(localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`));
      const segStartMs = Math.max(entryStartMs, dayStartMs);
      const segEndMs = Math.min(entryEndMs, dayEndMs);
      if (segEndMs <= segStartMs) continue;

      const rollup = rollupByDate.get(date);
      if (!rollup) continue;
      const segment: DaySegment = {
        start: new Date(segStartMs).toISOString(),
        end: new Date(segEndMs).toISOString(),
        categoryId: entry.categoryId,
        parentId,
      };
      rollup.segments.push(segment);
      const min = (segEndMs - segStartMs) / 60000;
      rollup.totalMin += min;
      rollup.byParent[parentId] = (rollup.byParent[parentId] ?? 0) + min;
    }
  }

  for (const rollup of rollups) {
    rollup.segments.sort((a, b) => toMs(a.start) - toMs(b.start));
    rollup.totalMin = Math.round(rollup.totalMin);
    for (const key of Object.keys(rollup.byParent)) rollup.byParent[key] = Math.round(rollup.byParent[key]);
    if (rollup.segments.length > 0) {
      rollup.firstActivity = rollup.segments[0].start;
      rollup.lastActivity = rollup.segments.reduce((max, s) => (toMs(s.end) > toMs(max) ? s.end : max), rollup.segments[0].end);
    }
  }
  return rollups;
}
