import type { HealthMetricRange } from "./types.js";

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function filterHealthRecordsByRange<T extends { date: string }>(
  records: readonly T[],
  range: HealthMetricRange,
  today = todayDate(),
): T[] {
  if (range === "all") return [...records];
  const days = Number(range);
  const from = addDays(today, -(days - 1));
  return records.filter((record) => record.date >= from && record.date <= today);
}
