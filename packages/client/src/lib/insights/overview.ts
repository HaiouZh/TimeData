import type { Category, TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { addDays } from "../time.ts";
import { resolveParentId } from "./sessions.js";

export type CoverageStatus = "normal" | "sleepNotConfigured" | "noSleepSamples";

export interface OverviewChildShare {
  categoryId: string;
  name: string;
  color: string;
  totalMin: number;
  shareOfParentPct: number;
}

export interface OverviewParentShare {
  parentId: string;
  name: string;
  color: string;
  totalMin: number;
  totalHours: number;
  sharePct: number;
  children: OverviewChildShare[];
}

export interface OverviewInsights {
  totalRecordedMin: number;
  totalRecordedHours: number;
  periodMin: number;
  sleepMin: number;
  awakeMin: number;
  coverageRawPct: number;
  coverageDisplayPct: number;
  coverageStatus: CoverageStatus;
  coverageNote: string | null;
  parents: OverviewParentShare[];
}

export interface OverviewInput {
  entries: TimeEntry[];
  categories: Category[];
  fromDate: string;
  toDate: string;
  sleepCategoryId: string | null;
}

const toMs = (iso: string) => new Date(iso).getTime();
const round1 = (value: number) => Math.round(value * 10) / 10;

function listDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate;
  for (let i = 0; i < 400 && cursor <= toDate; i++) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function categoryName(category: Category | undefined, fallback: string): string {
  return category?.name ?? fallback;
}

function categoryColor(category: Category | undefined): string {
  return category?.color ?? "#808080";
}

export function buildOverviewInsights(input: OverviewInput): OverviewInsights {
  const { entries, categories, fromDate, toDate, sleepCategoryId } = input;
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const rangeStartMs = toMs(localDateTimeToUtc(`${fromDate}T00:00:00`));
  const rangeEndMs = toMs(localDateTimeToUtc(`${addDays(toDate, 1)}T00:00:00`));
  const periodMin = listDates(fromDate, toDate).length * 1440;
  const byParent = new Map<string, number>();
  const byParentChild = new Map<string, Map<string, number>>();
  let totalRecordedMin = 0;
  let sleepMin = 0;

  for (const entry of entries) {
    const startMs = toMs(entry.startTime);
    const endMs = toMs(entry.endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const visibleStartMs = Math.max(startMs, rangeStartMs);
    const visibleEndMs = Math.min(endMs, rangeEndMs);
    if (visibleEndMs <= visibleStartMs) continue;

    const min = (visibleEndMs - visibleStartMs) / 60000;
    const parentId = resolveParentId(entry, categoryById);
    const childId = entry.categoryId;
    totalRecordedMin += min;
    byParent.set(parentId, (byParent.get(parentId) ?? 0) + min);
    const childTotals = byParentChild.get(parentId) ?? new Map<string, number>();
    childTotals.set(childId, (childTotals.get(childId) ?? 0) + min);
    byParentChild.set(parentId, childTotals);
    if (sleepCategoryId !== null && parentId === sleepCategoryId) sleepMin += min;
  }

  const roundedTotalMin = Math.round(totalRecordedMin);
  const roundedSleepMin = Math.round(sleepMin);
  let awakeMin = periodMin - roundedSleepMin;
  let coverageStatus: CoverageStatus = "normal";
  let coverageNote: string | null = null;
  if (sleepCategoryId === null) {
    awakeMin = periodMin;
    coverageStatus = "sleepNotConfigured";
    coverageNote = "未扣除睡眠";
  } else if (roundedSleepMin === 0) {
    awakeMin = periodMin;
    coverageStatus = "noSleepSamples";
    coverageNote = "暂无睡眠样本";
  }
  if (awakeMin <= 0) awakeMin = periodMin;
  const coverageRawPct = awakeMin > 0 ? (roundedTotalMin / awakeMin) * 100 : 0;

  const parents = Array.from(byParent.entries())
    .map(([parentId, min]) => {
      const roundedMin = Math.round(min);
      const parent = categoryById.get(parentId);
      const children = Array.from(byParentChild.get(parentId)?.entries() ?? [])
        .map(([categoryId, childMin]) => {
          const child = categoryById.get(categoryId);
          const childRoundedMin = Math.round(childMin);
          return {
            categoryId,
            name: categoryName(child, categoryId === parentId ? "未细分" : "其他"),
            color: categoryColor(child ?? parent),
            totalMin: childRoundedMin,
            shareOfParentPct: roundedMin > 0 ? round1((childRoundedMin / roundedMin) * 100) : 0,
          };
        })
        .filter((child) => child.totalMin > 0)
        .sort((a, b) => b.totalMin - a.totalMin);
      return {
        parentId,
        name: categoryName(parent, "其他"),
        color: categoryColor(parent),
        totalMin: roundedMin,
        totalHours: round1(roundedMin / 60),
        sharePct: roundedTotalMin > 0 ? round1((roundedMin / roundedTotalMin) * 100) : 0,
        children,
      };
    })
    .filter((parent) => parent.totalMin > 0)
    .sort((a, b) => b.totalMin - a.totalMin);

  return {
    totalRecordedMin: roundedTotalMin,
    totalRecordedHours: round1(roundedTotalMin / 60),
    periodMin,
    sleepMin: roundedSleepMin,
    awakeMin,
    coverageRawPct: round1(coverageRawPct),
    coverageDisplayPct: Math.min(100, round1(coverageRawPct)),
    coverageStatus,
    coverageNote,
    parents,
  };
}
