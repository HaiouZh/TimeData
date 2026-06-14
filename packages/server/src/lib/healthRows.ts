import type { HealthHeartRate, HealthHrv, HealthSleep, HealthStress, HealthRun } from "@timedata/shared";

export interface HealthHeartRateRow {
  id: string;
  date: string;
  resting_heart_rate: number | null;
  min_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_heart_rate: number | null;
  last_7_days_avg_resting_heart_rate: number | null;
  created_at: string;
  updated_at: string;
}

export function rowToHealthHeartRate(row: HealthHeartRateRow): HealthHeartRate {
  return {
    id: row.id,
    date: row.date,
    restingHeartRate: row.resting_heart_rate,
    minHeartRate: row.min_heart_rate,
    maxHeartRate: row.max_heart_rate,
    avgHeartRate: row.avg_heart_rate,
    last7DaysAvgRestingHeartRate: row.last_7_days_avg_resting_heart_rate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function healthHeartRateToRow(data: unknown): Record<string, string | number | null> {
  const hr = data as HealthHeartRate;
  return {
    id: hr.id,
    date: hr.date,
    resting_heart_rate: hr.restingHeartRate,
    min_heart_rate: hr.minHeartRate,
    max_heart_rate: hr.maxHeartRate,
    avg_heart_rate: hr.avgHeartRate,
    last_7_days_avg_resting_heart_rate: hr.last7DaysAvgRestingHeartRate,
  };
}

export interface HealthHrvRow {
  id: string;
  date: string;
  hrv_ms: number;
  created_at: string;
  updated_at: string;
}

export function rowToHealthHrv(row: HealthHrvRow): HealthHrv {
  return { id: row.id, date: row.date, hrvMs: row.hrv_ms, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function healthHrvToRow(data: unknown): Record<string, string | number | null> {
  const hrv = data as HealthHrv;
  return { id: hrv.id, date: hrv.date, hrv_ms: hrv.hrvMs };
}

export interface HealthSleepRow {
  id: string;
  date: string;
  sleep_start: string;
  wake_time: string;
  adjustment_hours: number;
  created_at: string;
  updated_at: string;
}

export function rowToHealthSleep(row: HealthSleepRow): HealthSleep {
  return {
    id: row.id,
    date: row.date,
    sleepStart: row.sleep_start,
    wakeTime: row.wake_time,
    adjustmentHours: row.adjustment_hours,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function healthSleepToRow(data: unknown): Record<string, string | number | null> {
  const s = data as HealthSleep;
  return { id: s.id, date: s.date, sleep_start: s.sleepStart, wake_time: s.wakeTime, adjustment_hours: s.adjustmentHours };
}

export interface HealthStressRow {
  id: string;
  date: string;
  stress: number;
  created_at: string;
  updated_at: string;
}

export function rowToHealthStress(row: HealthStressRow): HealthStress {
  return { id: row.id, date: row.date, stress: row.stress, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function healthStressToRow(data: unknown): Record<string, string | number | null> {
  const s = data as HealthStress;
  return { id: s.id, date: s.date, stress: s.stress };
}

export interface HealthRunRow {
  id: string;
  date: string;
  start_time: string;
  distance_km: number | null;
  duration_seconds: number | null;
  average_heart_rate: number | null;
  average_cadence: number | null;
  average_stride_m: number | null;
  average_vertical_ratio_percent: number | null;
  average_vertical_oscillation_cm: number | null;
  average_ground_contact_ms: number | null;
  type: string;
  city: string;
  created_at: string;
  updated_at: string;
}

export function rowToHealthRun(row: HealthRunRow): HealthRun {
  return {
    id: row.id,
    date: row.date,
    startTime: row.start_time,
    distanceKm: row.distance_km,
    durationSeconds: row.duration_seconds,
    averageHeartRate: row.average_heart_rate,
    averageCadence: row.average_cadence,
    averageStrideM: row.average_stride_m,
    averageVerticalRatioPercent: row.average_vertical_ratio_percent,
    averageVerticalOscillationCm: row.average_vertical_oscillation_cm,
    averageGroundContactMs: row.average_ground_contact_ms,
    type: row.type,
    city: row.city,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function healthRunToRow(data: unknown): Record<string, string | number | null> {
  const r = data as HealthRun;
  return {
    id: r.id,
    date: r.date,
    start_time: r.startTime,
    distance_km: r.distanceKm,
    duration_seconds: r.durationSeconds,
    average_heart_rate: r.averageHeartRate,
    average_cadence: r.averageCadence,
    average_stride_m: r.averageStrideM,
    average_vertical_ratio_percent: r.averageVerticalRatioPercent,
    average_vertical_oscillation_cm: r.averageVerticalOscillationCm,
    average_ground_contact_ms: r.averageGroundContactMs,
    type: r.type,
    city: r.city,
  };
}
