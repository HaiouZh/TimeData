import type { HealthHeartRate, HealthHrv, HealthRun, HealthStress } from "@timedata/shared";
import { computeSleepDurationHours, secondsPerKm } from "./format.js";
import type { HealthMetricCollections, MetricValueType } from "./types.js";

export interface DailyMetricDef {
  id: string;
  label: string;
  group: string;
  unit: string;
  valueType: MetricValueType;
  selectByDate(collections: HealthMetricCollections): Map<string, number | null>;
  paceComponentsByDate?(collections: HealthMetricCollections): Map<string, { durationSeconds: number; distanceKm: number }>;
}

function parseClockHours(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours + minutes / 60;
}

function dailyLatest<T extends { date: string; id: string }>(
  records: readonly T[] | undefined,
  project: (record: T) => number | null,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  const sorted = [...(records ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const record of sorted) map.set(record.date, project(record));
  return map;
}

interface RunDailyAgg {
  count: number;
  durationSeconds: number;
  distanceKm: number;
}

function runDailyAggregates(runs: readonly HealthRun[] | undefined): Map<string, RunDailyAgg> {
  const map = new Map<string, RunDailyAgg>();
  for (const run of runs ?? []) {
    const aggregate = map.get(run.date) ?? { count: 0, durationSeconds: 0, distanceKm: 0 };
    aggregate.count += 1;
    if (typeof run.durationSeconds === "number" && Number.isFinite(run.durationSeconds) && run.durationSeconds > 0) {
      aggregate.durationSeconds += run.durationSeconds;
    }
    if (typeof run.distanceKm === "number" && Number.isFinite(run.distanceKm) && run.distanceKm > 0) {
      aggregate.distanceKm += run.distanceKm;
    }
    map.set(run.date, aggregate);
  }
  return map;
}

const DEFS: DailyMetricDef[] = [
  {
    id: "sleep.duration",
    label: "睡眠时长",
    group: "睡眠",
    unit: "h",
    valueType: "number",
    selectByDate: (collections) => dailyLatest(collections.sleeps, (sleep) => computeSleepDurationHours(sleep)),
  },
  {
    id: "sleep.start",
    label: "入睡时间",
    group: "睡眠",
    unit: "",
    valueType: "time",
    selectByDate: (collections) =>
      dailyLatest(collections.sleeps, (sleep) => {
        const hours = parseClockHours(sleep.sleepStart);
        return hours < 19 ? hours + 24 : hours;
      }),
  },
  {
    id: "sleep.wake",
    label: "醒来时间",
    group: "睡眠",
    unit: "",
    valueType: "time",
    selectByDate: (collections) => dailyLatest(collections.sleeps, (sleep) => parseClockHours(sleep.wakeTime)),
  },
  {
    id: "hrv.value",
    label: "HRV",
    group: "状态",
    unit: "ms",
    valueType: "number",
    selectByDate: (collections) => dailyLatest(collections.hrvs, (hrv: HealthHrv) => hrv.hrvMs),
  },
  {
    id: "stress.value",
    label: "压力",
    group: "状态",
    unit: "",
    valueType: "number",
    selectByDate: (collections) => dailyLatest(collections.stresses, (stress: HealthStress) => stress.stress),
  },
  {
    id: "heart_rate.resting",
    label: "静息心率",
    group: "心率",
    unit: "bpm",
    valueType: "number",
    selectByDate: (collections) =>
      dailyLatest(collections.heartRates, (heartRate: HealthHeartRate) => heartRate.restingHeartRate),
  },
  {
    id: "heart_rate.min",
    label: "最低心率",
    group: "心率",
    unit: "bpm",
    valueType: "number",
    selectByDate: (collections) => dailyLatest(collections.heartRates, (heartRate: HealthHeartRate) => heartRate.minHeartRate),
  },
  {
    id: "heart_rate.max",
    label: "最高心率",
    group: "心率",
    unit: "bpm",
    valueType: "number",
    selectByDate: (collections) => dailyLatest(collections.heartRates, (heartRate: HealthHeartRate) => heartRate.maxHeartRate),
  },
  {
    id: "heart_rate.avg",
    label: "平均心率",
    group: "心率",
    unit: "bpm",
    valueType: "number",
    selectByDate: (collections) => dailyLatest(collections.heartRates, (heartRate: HealthHeartRate) => heartRate.avgHeartRate),
  },
  {
    id: "heart_rate.resting_7d_avg",
    label: "静息心率7日均值",
    group: "心率",
    unit: "bpm",
    valueType: "number",
    selectByDate: (collections) =>
      dailyLatest(collections.heartRates, (heartRate: HealthHeartRate) => heartRate.last7DaysAvgRestingHeartRate),
  },
  {
    id: "run.distance",
    label: "跑步距离",
    group: "跑步每日汇总",
    unit: "km",
    valueType: "number",
    selectByDate: (collections) => {
      const map = new Map<string, number | null>();
      for (const [date, aggregate] of runDailyAggregates(collections.runs)) {
        map.set(date, aggregate.distanceKm);
      }
      return map;
    },
  },
  {
    id: "run.count",
    label: "跑步次数",
    group: "跑步每日汇总",
    unit: "次",
    valueType: "number",
    selectByDate: (collections) => {
      const map = new Map<string, number | null>();
      for (const [date, aggregate] of runDailyAggregates(collections.runs)) {
        map.set(date, aggregate.count);
      }
      return map;
    },
  },
  {
    id: "run.pace",
    label: "跑步配速",
    group: "跑步每日汇总",
    unit: "",
    valueType: "pace",
    selectByDate: (collections) => {
      const map = new Map<string, number | null>();
      for (const [date, aggregate] of runDailyAggregates(collections.runs)) {
        map.set(date, secondsPerKm(aggregate.durationSeconds, aggregate.distanceKm));
      }
      return map;
    },
    paceComponentsByDate: (collections) => {
      const map = new Map<string, { durationSeconds: number; distanceKm: number }>();
      for (const [date, aggregate] of runDailyAggregates(collections.runs)) {
        map.set(date, { durationSeconds: aggregate.durationSeconds, distanceKm: aggregate.distanceKm });
      }
      return map;
    },
  },
];

const BY_ID = new Map(DEFS.map((def) => [def.id, def]));

export function listMetricDefs(): DailyMetricDef[] {
  return DEFS;
}

export function getMetricDef(id: string): DailyMetricDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown health metric: ${id}`);
  return def;
}

export function findMetricDef(id: string): DailyMetricDef | undefined {
  return BY_ID.get(id);
}
