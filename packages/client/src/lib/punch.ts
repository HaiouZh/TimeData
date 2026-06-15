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
