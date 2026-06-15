import type { HealthSleep } from "@timedata/shared";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatWholeSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}'${String(remainder).padStart(2, "0")}"`;
}

export function computeSleepDurationHours(sleep: HealthSleep): number {
  const [sleepHour, sleepMinute] = sleep.sleepStart.split(":").map(Number);
  const [wakeHour, wakeMinute] = sleep.wakeTime.split(":").map(Number);
  let minutes = wakeHour * 60 + wakeMinute - (sleepHour * 60 + sleepMinute);
  minutes += sleep.adjustmentHours * 60;
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}

export function secondsPerKm(durationSeconds: number | null, distanceKm: number | null): number | null {
  if (!isFiniteNumber(durationSeconds) || !isFiniteNumber(distanceKm) || durationSeconds <= 0 || distanceKm <= 0) {
    return null;
  }
  return durationSeconds / distanceKm;
}

export function formatPace(paceSecondsPerKm: number | null): string {
  if (!isFiniteNumber(paceSecondsPerKm) || paceSecondsPerKm <= 0) return "--";
  return formatWholeSeconds(paceSecondsPerKm);
}

export function formatRunPace(durationSeconds: number | null, distanceKm: number | null): string {
  return formatPace(secondsPerKm(durationSeconds, distanceKm));
}

export function formatDuration(seconds: number | null): string {
  if (!isFiniteNumber(seconds) || seconds <= 0) return "--";
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remainder}s`;
}

export function formatDecimalHours(hours: number | null): string | null {
  if (!isFiniteNumber(hours)) return null;
  return `${hours.toFixed(1)} h`;
}

export function formatIntegerUnit(value: number | null, unit?: string): string | null {
  if (!isFiniteNumber(value)) return null;
  return unit ? `${value} ${unit}` : `${value}`;
}

export function formatDistanceKm(distanceKm: number | null): string | null {
  if (!isFiniteNumber(distanceKm)) return null;
  return `${distanceKm.toFixed(1)} km`;
}

export function formatRunSummaryPace(durationSeconds: number | null, distanceKm: number | null): string | null {
  return formatPace(secondsPerKm(durationSeconds, distanceKm));
}

export function formatClockHours(hours: number | null): string {
  if (!isFiniteNumber(hours)) return "--";
  const normalized = ((hours % 24) + 24) % 24;
  let h = Math.floor(normalized);
  let m = Math.round((normalized - h) * 60);
  if (m === 60) {
    h = (h + 1) % 24;
    m = 0;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatNumberUnit(value: number | null, unit: string): string {
  if (!isFiniteNumber(value)) return "--";
  const rounded = Number.isInteger(value) ? `${value}` : value.toFixed(1);
  return unit ? `${rounded} ${unit}` : rounded;
}
