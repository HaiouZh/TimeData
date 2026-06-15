import type { TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { findLatestEntryEndingBefore, saveEntryWithOverlapAdjustments } from "../hooks/useEntries.js";
import { ensurePendingCategory } from "./pendingCategory.js";
import { getDateString } from "./time.js";

export interface PunchRange {
  startTime: string;
  endTime: string;
}

/**
 * 封口规则 2：起点 = 今天最后一条记录的 end（不早于今天 0 点）；否则用今天 0 点。
 * 若起点不早于 now（无时间可记，如同一刻连点），返回 null 表示 no-op。
 * 入参均为 UTC ISO 字符串，比较走时间戳避免格式差异。
 */
export function resolvePunchRange(
  nowUtc: string,
  todayStartUtc: string,
  lastEntryEndUtc: string | null,
): PunchRange | null {
  const todayStartMs = new Date(todayStartUtc).getTime();
  const start =
    lastEntryEndUtc && new Date(lastEntryEndUtc).getTime() >= todayStartMs ? lastEntryEndUtc : todayStartUtc;
  if (new Date(start).getTime() >= new Date(nowUtc).getTime()) return null;
  return { startTime: start, endTime: nowUtc };
}

/**
 * 一键打点：按规则 2 建一条 [起点 → 现在]、分类=待定 的普通时间记录。
 * 无时间可记时返回 null（调用方提示即可，不写任何记录）。
 */
export async function punchNow(now: Date = new Date()): Promise<TimeEntry | null> {
  const nowUtc = now.toISOString();
  const todayStartUtc = localDateTimeToUtc(`${getDateString(now)}T00:00:00`);
  const lastEntry = await findLatestEntryEndingBefore(new Date(now.getTime() + 1).toISOString());
  const range = resolvePunchRange(nowUtc, todayStartUtc, lastEntry?.endTime ?? null);
  if (!range) return null;

  const categoryId = await ensurePendingCategory(now);
  return saveEntryWithOverlapAdjustments({
    existingEntryId: null,
    categoryId,
    startTime: range.startTime,
    endTime: range.endTime,
    note: null,
    overlapPlan: null,
    now,
  });
}
