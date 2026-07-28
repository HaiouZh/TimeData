import { toLocalDateTimeString, weekdayIndex } from "../time.js";

/**
 * 完成节律矩阵：7(周一..周日) × 4 时段(0-6/6-12/12-18/18-24)，按本地时刻归属。
 * completed 为 completedAt ISO 时间戳数组（如 completionEvents 的输出）。
 * 与 getDateString 同源走 APP_TIME_ZONE，禁止 UTC 裸切割。
 */
export function rhythmMatrix(completed: string[]): number[][] {
  const matrix: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0]);

  for (const iso of completed) {
    const local = toLocalDateTimeString(new Date(iso));
    const dateStr = local.slice(0, 10);
    const hour = Number(local.slice(11, 13));
    const dayIndex = weekdayIndex(dateStr);
    const slotIndex = Math.min(3, Math.floor(hour / 6));
    matrix[dayIndex][slotIndex] += 1;
  }

  return matrix;
}
