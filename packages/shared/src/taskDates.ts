/** 把 Date 转为本地零点对应的 UTC ISO 字符串。 */
export function localDateOf(d: Date): string {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString();
}

/** 设备本地日历日的 "YYYY-MM-DD"（与 normalizeScheduledDate / placement 同一时区口径）。 */
export function localDateString(d: Date): string {
  return localDateOf(d).slice(0, 10);
}

/** 把 "YYYY-MM-DD" 格式字符串转为本地零点 UTC ISO。 */
export function normalizeScheduledDate(date: string): string {
  const [y = NaN, m = NaN, d = NaN] = date.split("-").map(Number);
  return localDateOf(new Date(y, m - 1, d));
}
