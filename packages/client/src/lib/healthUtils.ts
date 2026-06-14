import type { HealthSleep } from "@timedata/shared";
import {
  computeSleepDurationHours,
  filterHealthRecordsByRange,
  formatDuration,
  formatPace as formatPaceFromSeconds,
  secondsPerKm,
} from "./healthMetrics/index.js";

/** Filter health records by date range (last N days or all) */
export function filterByDateRange<T extends { date: string }>(data: T[], range: "30" | "90" | "all"): T[] {
  return filterHealthRecordsByRange(data, range);
}

/** Compute N-day rolling average for a numeric field */
export function computeRollingAverage(
  data: Array<{ date: string; [k: string]: unknown }>,
  field: string,
  windowSize: number,
): Array<{ date: string; value: number | null; avg: number | null }> {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const result: Array<{ date: string; value: number | null; avg: number | null }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const value = sorted[i][field] as number | null;
    let sum = 0;
    let count = 0;
    const start = Math.max(0, i - windowSize + 1);
    for (let j = start; j <= i; j++) {
      const v = sorted[j][field] as number | null;
      if (v != null) {
        sum += v;
        count++;
      }
    }
    result.push({ date: sorted[i].date, value, avg: count > 0 ? Math.round(sum / count) : null });
  }
  return result;
}

/** Calculate sleep duration in hours from HealthSleep record */
export function computeSleepDuration(sleep: HealthSleep): number {
  return computeSleepDurationHours(sleep);
}

/** Format pace (seconds per km) to min'sec" */
export function formatPace(durationSeconds: number | null, distanceKm: number | null): string {
  return formatPaceFromSeconds(secondsPerKm(durationSeconds, distanceKm));
}

/** Format duration in seconds to "Xh Ym" or "Ym Zs" */
export { formatDuration };
