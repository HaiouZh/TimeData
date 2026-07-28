import { addDays, getDateString, startOfWeek } from "../time.js";

export interface HeatmapCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

/** count→level：0 次为 0；max<4 时 count 本身即 level（自然封顶 4）；否则按 max 四等分。 */
function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (max < 4) return count as 0 | 1 | 2 | 3 | 4;
  const quartile = max / 4;
  return Math.min(4, Math.ceil(count / quartile)) as 0 | 1 | 2 | 3 | 4;
}

/**
 * 近 days 天的完成热力图格子。completed 为 completedAt ISO 时间戳数组（如 completionEvents 的输出）。
 * 首列对齐到「today 前 days 天」所在周的周一，末尾到 today，供 7 行 grid-flow-col 铺满整周。
 */
export function heatmapCells(completed: string[], today: string, days: number): HeatmapCell[] {
  const counts = new Map<string, number>();
  for (const iso of completed) {
    const day = getDateString(new Date(iso));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const rangeStart = addDays(today, -(days - 1));
  const gridStart = startOfWeek(rangeStart);
  const max = Math.max(0, ...Array.from(counts.values()));

  const cells: HeatmapCell[] = [];
  let cursor = gridStart;
  while (cursor <= today) {
    const count = counts.get(cursor) ?? 0;
    cells.push({ date: cursor, count, level: levelFor(count, max) });
    cursor = addDays(cursor, 1);
  }
  return cells;
}
