import type { TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { db } from "../db/index.js";
import { findLatestEntryEndingBefore, saveEntryWithOverlapAdjustments } from "../hooks/useEntries.js";
import { getPunchCategoryId } from "./settings/punchCategorySetting.js";
import { getDateString } from "./time.js";

export interface PunchRange {
  startTime: string;
  endTime: string;
}

export type PunchNowResult =
  | { ok: true; entry: TimeEntry }
  | { ok: false; reason: "missing_category" | "no_range" };

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
 * 一键打点：按规则 2 建一条 [起点 → 现在]、分类=全局打点分类 的普通时间记录。
 * 无时间可记或打点分类不可用时不写任何记录，由调用方提示。
 */
export async function punchNow(now: Date = new Date()): Promise<PunchNowResult> {
  const nowUtc = now.toISOString();
  const todayStartUtc = localDateTimeToUtc(`${getDateString(now)}T00:00:00`);
  const lastEntry = await findLatestEntryEndingBefore(new Date(now.getTime() + 1).toISOString());
  const range = resolvePunchRange(nowUtc, todayStartUtc, lastEntry?.endTime ?? null);
  if (!range) return { ok: false, reason: "no_range" };

  const categoryId = await resolveConfiguredPunchCategoryId();
  if (!categoryId) return { ok: false, reason: "missing_category" };

  const entry = await saveEntryWithOverlapAdjustments({
    existingEntryId: null,
    categoryId,
    startTime: range.startTime,
    endTime: range.endTime,
    note: null,
    overlapPlan: null,
    now,
  });
  return { ok: true, entry };
}

async function resolveConfiguredPunchCategoryId(): Promise<string | null> {
  const categoryId = await getPunchCategoryId();
  if (!categoryId) return null;

  const category = await db.categories.get(categoryId);
  if (!category || category.isArchived || !category.parentId) return null;

  const parent = await db.categories.get(category.parentId);
  if (!parent || parent.isArchived) return null;

  return categoryId;
}
