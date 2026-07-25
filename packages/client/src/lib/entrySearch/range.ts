import { localDateTimeToUtc } from "@timedata/shared";
import { addDays, addMonths, startOfWeek } from "../time.ts";

export type SearchRangeMode = "all" | "year" | "month" | "week";

/** 半开区间 [startUtc, endUtc)；null 表示该侧无约束（仅 all 档）。 */
export interface SearchRange {
  startUtc: string | null;
  endUtc: string | null;
}

export function buildSearchRange(mode: SearchRangeMode, anchorDate: string): SearchRange {
  if (mode === "all") return { startUtc: null, endUtc: null };

  let fromDate: string;
  let toExclusiveDate: string;

  if (mode === "year") {
    const year = Number(anchorDate.slice(0, 4));
    fromDate = `${year}-01-01`;
    toExclusiveDate = `${year + 1}-01-01`;
  } else if (mode === "month") {
    fromDate = `${anchorDate.slice(0, 7)}-01`;
    toExclusiveDate = addMonths(fromDate, 1);
  } else {
    fromDate = startOfWeek(anchorDate);
    toExclusiveDate = addDays(fromDate, 7);
  }

  return {
    startUtc: localDateTimeToUtc(`${fromDate}T00:00:00`),
    endUtc: localDateTimeToUtc(`${toExclusiveDate}T00:00:00`),
  };
}

export function shiftSearchAnchor(mode: SearchRangeMode, anchorDate: string, direction: -1 | 1): string {
  // all 档无区间可翻，UI 也隐藏箭头；此处兜底成空操作，避免调用方漏判。
  if (mode === "all") return anchorDate;
  // 走 addMonths 而非拼字符串：它带月末钳制（2028-02-29 +12 月 → 2029-02-28），拼字符串会造出非法日期。
  if (mode === "year") return addMonths(anchorDate, direction * 12);
  if (mode === "month") return addMonths(anchorDate, direction);
  return addDays(anchorDate, direction * 7);
}

export function formatSearchRangeLabel(mode: SearchRangeMode, anchorDate: string, today: string): string {
  if (mode === "all") return "全部";
  if (mode === "year") return anchorDate.slice(0, 4);
  if (mode === "month") return `${anchorDate.slice(0, 4)}年${anchorDate.slice(5, 7)}月`;

  const from = startOfWeek(anchorDate);
  if (from === startOfWeek(today)) return "本周";
  return `${from} ~ ${addDays(from, 6)}`;
}
