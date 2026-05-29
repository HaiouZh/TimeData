import type { Category, TimeEntry } from "@timedata/shared";
import { APP_TIME_ZONE } from "@timedata/shared";
import { INSIGHT_CONSTANTS } from "./constants.js";
import { buildInsightBaseline } from "./baseline.js";
import { buildDailyRollups } from "./dailyRollup.js";
import { buildSessions, resolveParentId } from "./sessions.js";
import type { Anomaly } from "./types.js";

const toMs = (iso: string) => new Date(iso).getTime();
const r1 = (x: number) => Math.round(x * 10) / 10;

// 某 UTC ISO 时刻在本地（APP_TIME_ZONE）一天内的分钟数 0..1439。
function localMinuteOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

// 本地日期串（YYYY-MM-DD）。
function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// 该时刻是否落在通常睡眠时段（23:00~07:00 跨午夜）。
function inSleepWindow(iso: string): boolean {
  const m = localMinuteOfDay(iso);
  const { sleepWindowStartMin, sleepWindowEndMin } = INSIGHT_CONSTANTS;
  return m >= sleepWindowStartMin || m < sleepWindowEndMin;
}

export interface DetectAnomaliesInput {
  entries: TimeEntry[];
  categories: Category[];
  fromDate: string;
  toDate: string;
  sleepCategoryId: string | null; // 用户指定的睡眠父分类 id；null=未指定
}

export function detectAnomalies(input: DetectAnomaliesInput): Anomaly[] {
  const { entries, categories, fromDate, toDate, sleepCategoryId } = input;
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const isSleep = (entry: TimeEntry) =>
    sleepCategoryId !== null && resolveParentId(entry, categoryById) === sleepCategoryId;

  const sessions = buildSessions(entries, categories);
  const rollups = buildDailyRollups(entries, categories, fromDate, toDate);

  // 基线：排除睡眠的会话时长；清醒空档（由日桶相邻片段间隙、排除睡眠窗与睡眠分类）。
  const nonSleepSessionDurations = sessions
    .filter((s) => !(sleepCategoryId !== null && s.parentId === sleepCategoryId))
    .filter((s) => s.durationMin >= INSIGHT_CONSTANTS.minSessionMin)
    .map((s) => s.durationMin);

  const awakeGapMins: number[] = [];
  const gapCandidates: { date: string; start: string; end: string; min: number }[] = [];
  for (const rollup of rollups) {
    for (let i = 1; i < rollup.segments.length; i++) {
      const prev = rollup.segments[i - 1];
      const next = rollup.segments[i];
      const gapMin = (toMs(next.start) - toMs(prev.end)) / 60000;
      if (gapMin <= 0) continue;
      // 清醒空档：两端都不是睡眠分类，且间隙起点不在睡眠时段。
      const prevSleep = sleepCategoryId !== null && prev.parentId === sleepCategoryId;
      const nextSleep = sleepCategoryId !== null && next.parentId === sleepCategoryId;
      if (prevSleep || nextSleep || inSleepWindow(prev.end)) continue;
      awakeGapMins.push(gapMin);
      gapCandidates.push({ date: rollup.date, start: prev.end, end: next.start, min: gapMin });
    }
  }

  const baseline = buildInsightBaseline({ nonSleepSessionDurations, awakeGapMins });
  const anomalies: Anomaly[] = [];

  // 1) 超长记录（排除睡眠，>= 阈值）。逐条 entry 判断。
  for (const entry of entries) {
    if (isSleep(entry)) continue;
    const durMin = (toMs(entry.endTime) - toMs(entry.startTime)) / 60000;
    if (durMin < baseline.overlongThresholdMin) continue;
    anomalies.push({
      type: "overlong",
      date: localDate(entry.startTime),
      startTime: entry.startTime,
      endTime: entry.endTime,
      categoryId: entry.categoryId,
      valueMin: r1(durMin),
      baselineMin: r1(baseline.overlongThresholdMin),
      message: `单条记录 ${r1(durMin / 60)}h，超过你常规上限 ${r1(baseline.overlongThresholdMin / 60)}h，疑似忘停。`,
    });
  }

  // 2) 跨午夜条目。
  for (const entry of entries) {
    if (localDate(entry.startTime) !== localDate(entry.endTime)) {
      anomalies.push({
        type: "overnight",
        date: localDate(entry.startTime),
        startTime: entry.startTime,
        endTime: entry.endTime,
        categoryId: entry.categoryId,
        message: `跨午夜记录：${localDate(entry.startTime)} 延续到 ${localDate(entry.endTime)}。`,
      });
    }
  }

  // 3) 非睡眠活动落在通常睡眠时段。
  for (const entry of entries) {
    if (isSleep(entry)) continue;
    if (inSleepWindow(entry.startTime)) {
      anomalies.push({
        type: "sleepTimeActivity",
        date: localDate(entry.startTime),
        startTime: entry.startTime,
        endTime: entry.endTime,
        categoryId: entry.categoryId,
        message: `通常睡眠时段（23:00~07:00）仍有活动。`,
      });
    }
  }

  // 4) 未记录天数（轻量）。
  for (const rollup of rollups) {
    if (rollup.totalMin === 0) {
      anomalies.push({ type: "unrecordedDay", date: rollup.date, message: `${rollup.date} 完全没有记录。` });
    }
  }

  // 5) 长空白（轻量，>= 阈值）。
  for (const gap of gapCandidates) {
    if (gap.min >= baseline.longGapThresholdMin) {
      anomalies.push({
        type: "longGap",
        date: gap.date,
        startTime: gap.start,
        endTime: gap.end,
        valueMin: r1(gap.min),
        baselineMin: r1(baseline.longGapThresholdMin),
        message: `清醒时段有 ${r1(gap.min / 60)}h 空白${baseline.longGapFromSample ? "，超过你的典型空档" : ""}。`,
      });
    }
  }

  // 按日期倒序（最近在前），同日按 startTime。
  return anomalies.sort((a, b) =>
    a.date === b.date
      ? (a.startTime ?? "").localeCompare(b.startTime ?? "")
      : b.date.localeCompare(a.date),
  );
}
