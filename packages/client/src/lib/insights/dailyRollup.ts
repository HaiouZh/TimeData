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

  const boundaryMs = dates.map((date) => toMs(localDateTimeToUtc(`${date}T00:00:00`)));
  boundaryMs.push(toMs(localDateTimeToUtc(`${addDays(dates[dates.length - 1] ?? fromDate, 1)}T00:00:00`)));

  const dayIndexOf = (ms: number): number => {
    if (dates.length === 0 || ms < boundaryMs[0] || ms >= boundaryMs[boundaryMs.length - 1]) return -1;
    let lo = 0;
    let hi = dates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (boundaryMs[mid] <= ms) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  for (const entry of entries) {
    const entryStartMs = toMs(entry.startTime);
    const entryEndMs = toMs(entry.endTime);
    if (!Number.isFinite(entryStartMs) || !Number.isFinite(entryEndMs) || entryEndMs <= entryStartMs) continue;
    const parentId = resolveParentId(entry, categoryById);

    const clampedStart = Math.max(entryStartMs, boundaryMs[0] ?? entryStartMs);
    const clampedEnd = Math.min(entryEndMs, boundaryMs[boundaryMs.length - 1] ?? entryEndMs);
    if (clampedEnd <= clampedStart) continue;

    const startIdx = dayIndexOf(clampedStart);
    const endIdx = dayIndexOf(clampedEnd - 1);
    if (startIdx < 0 || endIdx < 0) continue;

    for (let i = startIdx; i <= endIdx; i++) {
      const dayStartMs = boundaryMs[i];
      const dayEndMs = boundaryMs[i + 1];
      const segStartMs = Math.max(entryStartMs, dayStartMs);
      const segEndMs = Math.min(entryEndMs, dayEndMs);
      if (segEndMs <= segStartMs) continue;

      const rollup = rollups[i];
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
