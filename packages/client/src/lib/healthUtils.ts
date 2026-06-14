import type { HealthSleep } from "@timedata/shared";

/** Filter health records by date range (last N days or all) */
export function filterByDateRange<T extends { date: string }>(data: T[], range: "30" | "90" | "all"): T[] {
  if (range === "all") return data;
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - Number(range));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return data.filter((d) => d.date >= cutoffStr);
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
      if (v != null) { sum += v; count++; }
    }
    result.push({ date: sorted[i].date, value, avg: count > 0 ? Math.round(sum / count) : null });
  }
  return result;
}

/** Calculate sleep duration in hours from HealthSleep record */
export function computeSleepDuration(sleep: HealthSleep): number {
  const [sh, sm] = sleep.sleepStart.split(":").map(Number);
  const [wh, wm] = sleep.wakeTime.split(":").map(Number);
  const sleepMinutes = sh * 60 + sm;
  const wakeMinutes = wh * 60 + wm;
  // sleepStart is usually in the evening, wakeTime in the morning
  // adjustmentHours handles timezone/cross-day adjustment
  let diff = wakeMinutes - sleepMinutes + sleep.adjustmentHours * 60;
  if (diff < 0) diff += 24 * 60; // crossed midnight
  return diff / 60;
}

/** Format pace (seconds per km) to min'sec" */
export function formatPace(durationSeconds: number | null, distanceKm: number | null): string {
  if (!durationSeconds || !distanceKm || distanceKm === 0) return "--";
  const paceSeconds = durationSeconds / distanceKm;
  const min = Math.floor(paceSeconds / 60);
  const sec = Math.floor(paceSeconds % 60);
  return `${min}'${sec.toString().padStart(2, "0")}"`;
}

/** Format duration in seconds to "Xh Ym" or "Ym Zs" */
export function formatDuration(seconds: number | null): string {
  if (!seconds) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}
