import type { Recurrence } from "@timedata/shared";
import { normalizeScheduledDate } from "./placement.js";

export type PresetActionKey =
  | "none"
  | "scheduled"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "monthEnd"
  | "custom";
export type RecurrencePresetKey = Extract<PresetActionKey, "daily" | "weekdays" | "weekly" | "monthly" | "monthEnd">;

export type RecurrenceChoice =
  | { kind: "none" }
  | { kind: "scheduled"; date: string }
  | { kind: "recurrence"; recurrence: Recurrence; startAt: string | null };

export type CustomRecurrenceEndMode = "never" | "count" | "until";

export interface CustomRecurrenceInput {
  unit: Recurrence["freq"];
  interval: number;
  start: string;
  endMode: CustomRecurrenceEndMode;
  basis: Recurrence["basis"];
  time?: string;
  count?: number;
  until?: string;
  byWeekday?: number[];
  byMonthday?: number[];
  preservedByWeekday?: number[];
  preservedByMonthday?: number[];
  preserveHitDays?: boolean;
  monthEnd?: boolean;
}

export interface PresetRow {
  key: PresetActionKey;
  label: string;
  checked: boolean;
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;
const WEEKDAYS = [1, 2, 3, 4, 5] as const;
const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseYmd(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) throw new Error("date must start with YYYY-MM-DD");
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function localDateInputOf(value: string): string {
  if (DATE_INPUT_RE.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthDayLabel(value: string): string {
  const date = localDateInputOf(value);
  return date.slice(5, 10);
}

function positiveInt(value: number | undefined, fallback = 1): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(999, Math.max(1, Math.trunc(value)));
}

function validWeekdays(values: number[] | undefined): number[] | null {
  if (!values) return null;
  const next = values.filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
  return next.length > 0 ? next : null;
}

function validMonthdays(values: number[] | undefined): number[] | null {
  if (!values) return null;
  const next = values.filter((value) => Number.isInteger(value) && (value === -1 || (value >= 1 && value <= 31)));
  return next.length > 0 ? next : null;
}

function sameNumbers(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function hasPresetModifiers(recurrence: Recurrence): boolean {
  return recurrence.basis !== "due" || recurrence.time != null || recurrence.count != null || recurrence.until != null;
}

function withEndMode(recurrence: Recurrence, input: CustomRecurrenceInput): Recurrence {
  if (input.endMode === "count") return { ...recurrence, count: positiveInt(input.count) };
  if (input.endMode === "until") return { ...recurrence, until: normalizeScheduledDate(input.until ?? input.start) };
  return recurrence;
}

function withTime(recurrence: Recurrence, time: string | undefined): Recurrence {
  return time && TIME_RE.test(time) ? { ...recurrence, time } : recurrence;
}

export function isoWeekdayOf(date: string): number {
  const { y, m, d } = parseYmd(date);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

export function monthdayOf(date: string): number {
  return parseYmd(date).d;
}

export function isLastDayOfMonth(date: string): boolean {
  const { y, m, d } = parseYmd(date);
  return d === new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function presetToRecurrence(preset: RecurrencePresetKey, anchor: string): Recurrence {
  if (preset === "daily") return { freq: "daily", interval: 1, basis: "due" };
  if (preset === "weekdays") return { freq: "weekly", interval: 1, byWeekday: [...WEEKDAYS], basis: "due" };
  if (preset === "weekly") return { freq: "weekly", interval: 1, byWeekday: [isoWeekdayOf(anchor)], basis: "due" };
  if (preset === "monthly") return { freq: "monthly", interval: 1, byMonthday: [monthdayOf(anchor)], basis: "due" };
  return { freq: "monthly", interval: 1, byMonthday: [-1], basis: "due" };
}

export function recurrenceMatchesPreset(
  recurrence: Recurrence | null | undefined,
): Exclude<PresetActionKey, "scheduled"> {
  if (!recurrence) return "none";
  if (hasPresetModifiers(recurrence) || recurrence.interval !== 1) return "custom";

  if (recurrence.freq === "daily") {
    return recurrence.byWeekday == null && recurrence.byMonthday == null ? "daily" : "custom";
  }

  if (recurrence.freq === "weekly") {
    if (recurrence.byMonthday != null) return "custom";
    if (sameNumbers(recurrence.byWeekday, WEEKDAYS)) return "weekdays";
    return recurrence.byWeekday?.length === 1 ? "weekly" : "custom";
  }

  if (recurrence.byWeekday != null) return "custom";
  if (sameNumbers(recurrence.byMonthday, [-1])) return "monthEnd";
  return recurrence.byMonthday?.length === 1 && recurrence.byMonthday[0] !== -1 ? "monthly" : "custom";
}

export function recurrenceToCustomInput(
  recurrence: Recurrence,
  startAt: string | null,
  fallbackStart: string,
): CustomRecurrenceInput {
  const localStart = startAt ? localDateInputOf(startAt) : localDateInputOf(fallbackStart);
  const input: CustomRecurrenceInput = {
    unit: recurrence.freq,
    interval: recurrence.interval,
    start: localStart,
    basis: recurrence.basis,
    preserveHitDays: true,
    endMode: recurrence.count != null ? "count" : recurrence.until != null ? "until" : "never",
  };

  if (recurrence.time != null) input.time = recurrence.time;
  if (recurrence.count != null) input.count = recurrence.count;
  if (recurrence.until != null) input.until = localDateInputOf(recurrence.until);

  if (recurrence.freq === "weekly") {
    const byWeekday = recurrence.byWeekday ?? [isoWeekdayOf(localStart)];
    input.byWeekday = [...byWeekday];
    input.preservedByWeekday = [...byWeekday];
  }

  if (recurrence.freq === "monthly") {
    const byMonthday = recurrence.byMonthday ?? [monthdayOf(localStart)];
    input.byMonthday = [...byMonthday];
    input.preservedByMonthday = [...byMonthday];
    input.monthEnd = sameNumbers(byMonthday, [-1]);
  }

  return input;
}

export function customToRecurrence(input: CustomRecurrenceInput): Recurrence {
  const interval = positiveInt(input.interval);
  const basis = input.basis ?? "due";
  const anchor = localDateInputOf(input.start);

  let recurrence: Recurrence;
  if (input.unit === "daily") {
    recurrence = { freq: "daily", interval, basis };
  } else if (input.unit === "weekly") {
    const preserved = input.preserveHitDays
      ? (validWeekdays(input.preservedByWeekday) ?? validWeekdays(input.byWeekday))
      : null;
    recurrence = { freq: "weekly", interval, basis, byWeekday: preserved ?? [isoWeekdayOf(anchor)] };
  } else {
    const preserved = input.preserveHitDays
      ? (validMonthdays(input.preservedByMonthday) ?? validMonthdays(input.byMonthday))
      : null;
    recurrence = {
      freq: "monthly",
      interval,
      basis,
      byMonthday: input.monthEnd ? [-1] : (preserved ?? [monthdayOf(anchor)]),
    };
  }

  return withEndMode(withTime(recurrence, input.time), input);
}

export function buildPresetRows(
  anchor: string,
  currentRecurrence: Recurrence | null,
  scheduledAt: string | null,
): PresetRow[] {
  const checkedKey: PresetActionKey = currentRecurrence
    ? recurrenceMatchesPreset(currentRecurrence)
    : scheduledAt
      ? "scheduled"
      : "none";
  const rows: Array<Omit<PresetRow, "checked">> = [
    { key: "none", label: "不重复" },
    { key: "scheduled", label: scheduledAt ? `仅某天 ${monthDayLabel(scheduledAt)}` : "仅某天…" },
    { key: "daily", label: "每天" },
    { key: "weekdays", label: "工作日" },
    { key: "weekly", label: `每周${WEEKDAY_LABELS[isoWeekdayOf(anchor) - 1]}` },
    { key: "monthly", label: `每月${monthdayOf(anchor)}号` },
    { key: "monthEnd", label: "每月最后一天" },
    { key: "custom", label: "自定义…" },
  ];

  return rows.map((row) => ({ ...row, checked: row.key === checkedKey }));
}
