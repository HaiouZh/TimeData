import { addDays } from "../time.ts";

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** 把 date 换到 year 对应的同月同日；闰年 2-29 在平年顺延为 2-28（spec 钉死）。 */
export function sameDayInYear(date: string, year: number): string {
  const [, mm, dd] = date.split("-");
  if (mm === "02" && dd === "29" && !isLeap(year)) return `${year}-02-28`;
  return `${year}-${mm}-${dd}`;
}

/** ISO 周：周一起始，本周四所在年为 ISO 年。纯字符串/UTC 运算，与时区无关。 */
export function isoWeekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const isoYear = dt.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** 该日所在 ISO 周的周一。 */
export function isoWeekMonday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  return addDays(date, 1 - day);
}

/** 模式 A：左=昨天在近 N 年（含当年，降序）同日，右=anchor 同理。 */
export function modeADates(anchor: string, years: number): { left: string[]; right: string[] } {
  const yesterday = addDays(anchor, -1);
  const spread = (base: string) => {
    const baseYear = Number(base.slice(0, 4));
    return Array.from({ length: years }, (_, i) => sameDayInYear(base, baseYear - i));
  };
  return { left: spread(yesterday), right: spread(anchor) };
}

/** 模式 B：anchor 前三天。 */
export const modeBDates = (anchor: string): string[] => [addDays(anchor, -1), addDays(anchor, -2), addDays(anchor, -3)];

/** 模式 C：上周与本周各 7 天，周一起。 */
export function modeCDates(anchor: string) {
  const mon = isoWeekMonday(anchor);
  const lastMon = addDays(mon, -7);
  const week = (start: string) => ({ key: isoWeekKey(start), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) });
  return { lastWeek: week(lastMon), thisWeek: week(mon) };
}
