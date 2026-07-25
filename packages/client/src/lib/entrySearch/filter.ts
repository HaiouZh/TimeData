import type { TimeEntry } from "@timedata/shared";
import { matchesAllTerms } from "../../quick-notes/searchTerms.js";
import { getDateString } from "../time.js";
import type { SearchRange } from "./range.js";

export interface SearchFilters {
  range: SearchRange;
  /** null = 不按分类过滤；数组 = 命中集合（空数组即命中不到任何记录）。 */
  categoryIds: string[] | null;
  /** parseSearchTerms 的结果；[] = 不按关键词过滤。 */
  terms: string[];
}

export interface SearchSummary {
  /** 有记录的天数（按开始日去重），不是区间总天数。 */
  dayCount: number;
  totalMinutes: number;
  /** 总时长 ÷ 有记录的天数；dayCount 为 0 时为 0。 */
  avgMinutesPerDay: number;
  entryCount: number;
}

/** 归属只看 startTime：跨夜记录整条算开始那天（与 /stats/time 的裁剪口径有意不同，见 design §口径分叉）。 */
export function filterSearchEntries(entries: TimeEntry[], filters: SearchFilters): TimeEntry[] {
  const { range, categoryIds, terms } = filters;
  const categorySet = categoryIds === null ? null : new Set(categoryIds);

  const matched = entries.filter((entry) => {
    if (range.startUtc !== null && entry.startTime < range.startUtc) return false;
    if (range.endUtc !== null && entry.startTime >= range.endUtc) return false;
    if (categorySet !== null && !categorySet.has(entry.categoryId)) return false;
    if (terms.length > 0) {
      if (entry.note === null) return false;
      if (!matchesAllTerms(entry.note.toLowerCase(), terms)) return false;
    }
    return true;
  });

  return matched.sort((a, b) => (a.startTime < b.startTime ? 1 : a.startTime > b.startTime ? -1 : 0));
}

export function summarizeSearchEntries(entries: TimeEntry[]): SearchSummary {
  const days = new Set<string>();
  let totalMs = 0;

  for (const entry of entries) {
    days.add(getDateString(new Date(entry.startTime)));
    totalMs += new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
  }

  const dayCount = days.size;
  const totalMinutes = totalMs / 60000;

  return {
    dayCount,
    totalMinutes,
    avgMinutesPerDay: dayCount === 0 ? 0 : totalMinutes / dayCount,
    entryCount: entries.length,
  };
}
