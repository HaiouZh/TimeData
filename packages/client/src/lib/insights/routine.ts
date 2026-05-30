import type { Category, TimeEntry } from "@timedata/shared";
import { APP_TIME_ZONE } from "@timedata/shared";
import { INSIGHT_CONSTANTS } from "./constants.js";
import { buildSessions, resolveParentId } from "./sessions.js";

export type RoutineRegularityState = "notConfigured" | "noSamples" | "insufficientSamples" | "stable" | "variable";

export interface SleepRoutineSample {
  date: string;
  bedTime: string;
  wakeTime: string;
  bedTimeMin: number;
  wakeTimeMin: number;
  durationMin: number;
  mainDurationMin: number;
}

export interface SleepWindow {
  startMin: number;
  endMin: number;
  source: "samples" | "fallback";
}

export interface RoutineInsights {
  sleepCategoryConfigured: boolean;
  sampleCount: number;
  samples: SleepRoutineSample[];
  averageBedTimeMin: number | null;
  averageWakeTimeMin: number | null;
  averageDurationMin: number | null;
  regularity: {
    state: RoutineRegularityState;
    sampleCount: number;
    bedTimeStdevMin: number | null;
    wakeTimeStdevMin: number | null;
    durationStdevMin: number | null;
  };
  sleepWindow: SleepWindow;
}

export interface RoutineInput {
  entries: TimeEntry[];
  categories: Category[];
  fromDate: string;
  toDate: string;
  sleepCategoryId: string | null;
}

const toMs = (iso: string) => new Date(iso).getTime();
const round1 = (value: number) => Math.round(value * 10) / 10;

function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function localMinuteOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  return (
    Number(parts.find((p) => p.type === "hour")?.value ?? "0") * 60 +
    Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  );
}

function fallbackWindow(): SleepWindow {
  return {
    startMin: INSIGHT_CONSTANTS.sleepWindowStartMin,
    endMin: INSIGHT_CONSTANTS.sleepWindowEndMin,
    source: "fallback",
  };
}

function unwrapMinutes(values: number[]): number[] {
  if (values.length === 0) return [];
  const base = values[0];
  return values.map((value) => {
    let unwrapped = value;
    while (unwrapped - base > 720) unwrapped -= 1440;
    while (unwrapped - base < -720) unwrapped += 1440;
    return unwrapped;
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function circularAverage(values: number[]): number | null {
  const avg = average(unwrapMinutes(values));
  if (avg === null) return null;
  return ((Math.round(avg) % 1440) + 1440) % 1440;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function circularMedian(values: number[]): number | null {
  const median = quantile(unwrapMinutes(values), 0.5);
  if (median === null) return null;
  return ((Math.round(median) % 1440) + 1440) % 1440;
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = average(values);
  if (avg === null) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function circularStdev(values: number[]): number | null {
  const unwrapped = unwrapMinutes(values);
  const value = stdev(unwrapped);
  return value === null ? null : round1(value);
}

function simpleStdev(values: number[]): number | null {
  const value = stdev(values);
  return value === null ? null : round1(value);
}

export function formatClockFromMinute(minute: number | null): string {
  if (minute === null || !Number.isFinite(minute)) return "--:--";
  const normalized = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const min = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function buildRoutineInsights(input: RoutineInput): RoutineInsights {
  const { entries, categories, fromDate, toDate, sleepCategoryId } = input;
  if (sleepCategoryId === null) {
    return {
      sleepCategoryConfigured: false,
      sampleCount: 0,
      samples: [],
      averageBedTimeMin: null,
      averageWakeTimeMin: null,
      averageDurationMin: null,
      regularity: {
        state: "notConfigured",
        sampleCount: 0,
        bedTimeStdevMin: null,
        wakeTimeStdevMin: null,
        durationStdevMin: null,
      },
      sleepWindow: fallbackWindow(),
    };
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const sleepEntries = entries.filter((entry) => resolveParentId(entry, categoryById) === sleepCategoryId);
  const totalByWakeDate = new Map<string, number>();
  for (const entry of sleepEntries) {
    const startMs = toMs(entry.startTime);
    const endMs = toMs(entry.endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const wakeDate = localDate(entry.endTime);
    totalByWakeDate.set(wakeDate, (totalByWakeDate.get(wakeDate) ?? 0) + (endMs - startMs) / 60000);
  }

  const sessions = buildSessions(sleepEntries, categories);
  const mainByWakeDate = new Map<string, (typeof sessions)[number]>();
  for (const session of sessions) {
    if (session.durationMin < INSIGHT_CONSTANTS.routineMainSleepMin) continue;
    const wakeDate = localDate(session.endTime);
    const current = mainByWakeDate.get(wakeDate);
    if (!current || session.durationMin > current.durationMin) mainByWakeDate.set(wakeDate, session);
  }

  const samples = Array.from(mainByWakeDate.entries())
    .filter(([date]) => date >= fromDate && date <= toDate)
    .map(([date, session]) => ({
      date,
      bedTime: session.startTime,
      wakeTime: session.endTime,
      bedTimeMin: localMinuteOfDay(session.startTime),
      wakeTimeMin: localMinuteOfDay(session.endTime),
      durationMin: Math.round(totalByWakeDate.get(date) ?? session.durationMin),
      mainDurationMin: Math.round(session.durationMin),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const sampleCount = samples.length;
  const bedMins = samples.map((sample) => sample.bedTimeMin);
  const wakeMins = samples.map((sample) => sample.wakeTimeMin);
  const durationMins = samples.map((sample) => sample.durationMin);
  const averageBedTimeMin = circularAverage(bedMins);
  const averageWakeTimeMin = circularAverage(wakeMins);
  const averageDuration = average(durationMins);
  const bedTimeStdevMin = circularStdev(bedMins);
  const wakeTimeStdevMin = circularStdev(wakeMins);
  const durationStdevMin = simpleStdev(durationMins);
  const bedMedianMin = circularMedian(bedMins);
  const wakeMedianMin = circularMedian(wakeMins);
  const hasWindowSamples = sampleCount >= INSIGHT_CONSTANTS.routineMinRegularitySamples;
  const sleepWindow =
    hasWindowSamples && bedMedianMin !== null && wakeMedianMin !== null
      ? {
          startMin: bedMedianMin - INSIGHT_CONSTANTS.routineSleepWindowPaddingMin,
          endMin: wakeMedianMin + INSIGHT_CONSTANTS.routineSleepWindowPaddingMin,
          source: "samples" as const,
        }
      : fallbackWindow();

  let state: RoutineRegularityState;
  if (sampleCount === 0) state = "noSamples";
  else if (sampleCount < INSIGHT_CONSTANTS.routineMinRegularitySamples) state = "insufficientSamples";
  else {
    const maxSpread = Math.max(bedTimeStdevMin ?? 0, wakeTimeStdevMin ?? 0, durationStdevMin ?? 0);
    state = maxSpread <= INSIGHT_CONSTANTS.routineStableStdevMaxMin ? "stable" : "variable";
  }

  return {
    sleepCategoryConfigured: true,
    sampleCount,
    samples,
    averageBedTimeMin,
    averageWakeTimeMin,
    averageDurationMin: averageDuration === null ? null : round1(averageDuration),
    regularity: {
      state,
      sampleCount,
      bedTimeStdevMin,
      wakeTimeStdevMin,
      durationStdevMin,
    },
    sleepWindow,
  };
}
