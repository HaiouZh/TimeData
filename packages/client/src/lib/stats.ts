import type { Category, TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { addDays, addMonths, getDateString, startOfWeek } from "./time.ts";

export type StatsViewMode = "day" | "week" | "month";

export interface StatsRange {
  fromDate: string;
  toDate: string;
  startUtc: string;
  endUtc: string;
}

export interface CategoryStatsRow {
  id: string;
  name: string;
  value: number;
  color: string;
}

export function buildStatsRange(mode: StatsViewMode, now: Date = new Date()): StatsRange {
  return buildStatsRangeForDate(mode, getDateString(now));
}

export function buildStatsRangeForDate(mode: StatsViewMode, anchorDate: string): StatsRange {
  let fromDate: string;
  let toDate: string;
  if (mode === "day") {
    fromDate = anchorDate;
    toDate = anchorDate;
  } else if (mode === "week") {
    fromDate = startOfWeek(anchorDate);
    toDate = addDays(fromDate, 6);
  } else {
    fromDate = `${anchorDate.slice(0, 7)}-01`;
    toDate = addDays(addMonths(fromDate, 1), -1);
  }

  return {
    fromDate,
    toDate,
    startUtc: localDateTimeToUtc(`${fromDate}T00:00:00`),
    endUtc: localDateTimeToUtc(`${addDays(toDate, 1)}T00:00:00`),
  };
}

export function shiftStatsAnchor(mode: StatsViewMode, anchorDate: string, direction: -1 | 1): string {
  if (mode === "day") return addDays(anchorDate, direction);
  if (mode === "week") return addDays(anchorDate, direction * 7);
  return addMonths(anchorDate, direction);
}

// 当前周期已包含今天或落在其后 → 不允许再往后翻。YYYY-MM-DD 字典序可直接比较。
export function isLatestPeriod(mode: StatsViewMode, anchorDate: string, today: string): boolean {
  return buildStatsRangeForDate(mode, anchorDate).toDate >= today;
}

export function formatStatsRangeLabel(mode: StatsViewMode, range: StatsRange): string {
  if (mode === "day") return range.fromDate;
  if (mode === "month") return `${range.fromDate.slice(0, 4)}年${range.fromDate.slice(5, 7)}月`;
  return `${range.fromDate} ~ ${range.toDate}`;
}

function toMs(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function roundHours(ms: number): number {
  return Math.round((ms / 3600000) * 10) / 10;
}

export function summarizeEntriesByParentCategory(
  entries: TimeEntry[],
  categories: Category[],
  parentCategories: Category[],
  range: StatsRange,
): CategoryStatsRow[] {
  const rangeStartMs = toMs(range.startUtc);
  const rangeEndMs = toMs(range.endUtc);
  if (rangeStartMs === null || rangeEndMs === null || rangeEndMs <= rangeStartMs) return [];

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const parentById = new Map(parentCategories.map((category) => [category.id, category]));
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const entryStartMs = toMs(entry.startTime);
    const entryEndMs = toMs(entry.endTime);
    if (entryStartMs === null || entryEndMs === null || entryEndMs <= entryStartMs) continue;
    if (entryStartMs >= rangeEndMs || entryEndMs <= rangeStartMs) continue;

    const visibleStartMs = Math.max(entryStartMs, rangeStartMs);
    const visibleEndMs = Math.min(entryEndMs, rangeEndMs);
    if (visibleEndMs <= visibleStartMs) continue;

    const category = categoryById.get(entry.categoryId);
    const categoryParentId = category?.parentId;
    const parentId = categoryParentId
      ? parentById.has(categoryParentId)
        ? categoryParentId
        : "unknown"
      : category?.id || "unknown";
    totals.set(parentId, (totals.get(parentId) || 0) + (visibleEndMs - visibleStartMs));
  }

  return Array.from(totals.entries())
    .map(([id, ms]) => {
      const parent = parentById.get(id);
      return {
        id,
        name: parent?.name || "其他",
        value: roundHours(ms),
        color: parent?.color || "#808080",
      };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}
