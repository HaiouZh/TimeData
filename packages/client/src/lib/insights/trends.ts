import type { Category, TimeEntry } from "@timedata/shared";
import { addDays } from "../time.ts";
import { INSIGHT_CONSTANTS } from "./constants.js";
import { buildDailyRollups } from "./dailyRollup.js";

// 趋势窗口规格：预设天数 / 自定义天数 / 自定义起止区间。
export type TrendWindowSpec =
  | { kind: "preset"; days: number }
  | { kind: "customDays"; days: number }
  | { kind: "customRange"; from: string; to: string };

// 解析后的本期 + 等长上一窗口（均本地 YYYY-MM-DD）。
export interface TrendWindow {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

// 含端点的本地日天数（UTC 午夜差，无 DST 误差）。
function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

// T5：独立窗口。预设/自定义天数 = 今天往前 N 天；自定义区间用户指定（to 不超 today）。
// 上一窗口（任意 kind）= 等长紧邻前移：prevTo = from-1，prevFrom = prevTo-(len-1)。
export function resolveTrendWindow(spec: TrendWindowSpec, today: string): TrendWindow {
  let from: string;
  let to: string;
  if (spec.kind === "customRange") {
    to = spec.to > today ? today : spec.to;
    from = spec.from > to ? to : spec.from;
  } else {
    // preset 与 customDays 语义相同：均取 [1,365] clamp 后 = 今天往前 N 天。
    const days = Math.min(Math.max(Math.round(spec.days), 1), 365);
    to = today;
    from = addDays(today, -(days - 1));
  }
  const len = dayCount(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return { from, to, prevFrom, prevTo };
}

export type TrendState = "compared" | "new" | "dropped" | "noBaseline";

// 单个父分类的环比结果。deltaPct 仅 compared 态有值。
export interface ParentTrend {
  parentId: string;
  currentMin: number;
  previousMin: number;
  deltaPct: number | null;
  state: TrendState;
}

// 折线/堆叠面积的单日数据点（缺数据日 byParent 为空对象，渲染按 0 处理，T4）。
export interface TrendPoint {
  date: string;
  byParent: Record<string, number>;
}

export interface TrendResult {
  window: TrendWindow;
  parentTrends: ParentTrend[]; // 按 currentMin 降序
  topRising: ParentTrend[];
  topFalling: ParentTrend[];
  droppedParents: ParentTrend[];
  points: TrendPoint[];
  prevComparable: boolean;
}

export interface BuildTrendOptions {
  topN?: number;
  prevMinDaysWithData?: number;
  pctBaseFloorMin?: number;
}

// 单父分类环比分级（校准 T1/T2）。优先级：noBaseline > new > dropped > compared。
function classifyTrend(
  parentId: string,
  currentMin: number,
  previousMin: number,
  prevComparable: boolean,
  pctBaseFloorMin: number,
): ParentTrend {
  let state: TrendState;
  let deltaPct: number | null = null;
  if (!prevComparable) {
    state = "noBaseline";
  } else if (previousMin < pctBaseFloorMin && currentMin > 0) {
    state = "new";
  } else if (currentMin === 0 && previousMin >= pctBaseFloorMin) {
    state = "dropped";
  } else {
    state = "compared";
    deltaPct = previousMin > 0 ? Math.round(((currentMin - previousMin) / previousMin) * 1000) / 10 : 0;
  }
  return { parentId, currentMin: Math.round(currentMin), previousMin: Math.round(previousMin), deltaPct, state };
}

// 趋势聚合：复用日桶 byParent 按窗口求和，逐父分类算环比，给出 TopN 与折线序列。
export function buildTrend(
  entries: TimeEntry[],
  categories: Category[],
  window: TrendWindow,
  options: BuildTrendOptions = {},
): TrendResult {
  const topN = options.topN ?? INSIGHT_CONSTANTS.trendTopN;
  const prevMinDays = options.prevMinDaysWithData ?? INSIGHT_CONSTANTS.trendPrevMinDaysWithData;
  const pctFloor = options.pctBaseFloorMin ?? INSIGHT_CONSTANTS.trendPctBaseFloorMin;

  // 一次性覆盖上期起到本期止（连续区间，中间空隙日为 0 桶）。
  const rollups = buildDailyRollups(entries, categories, window.prevFrom, window.to);

  const currentByParent = new Map<string, number>();
  const previousByParent = new Map<string, number>();
  let prevDaysWithData = 0;
  const points: TrendPoint[] = [];

  for (const rollup of rollups) {
    if (rollup.date >= window.from && rollup.date <= window.to) {
      points.push({ date: rollup.date, byParent: { ...rollup.byParent } });
      for (const [parentId, min] of Object.entries(rollup.byParent)) {
        currentByParent.set(parentId, (currentByParent.get(parentId) ?? 0) + min);
      }
    } else if (rollup.date >= window.prevFrom && rollup.date <= window.prevTo) {
      if (rollup.totalMin > 0) prevDaysWithData += 1;
      for (const [parentId, min] of Object.entries(rollup.byParent)) {
        previousByParent.set(parentId, (previousByParent.get(parentId) ?? 0) + min);
      }
    }
  }

  const prevComparable = prevDaysWithData >= prevMinDays;
  const parentIds = new Set<string>([...currentByParent.keys(), ...previousByParent.keys()]);
  const parentTrends = [...parentIds]
    .map((parentId) =>
      classifyTrend(parentId, currentByParent.get(parentId) ?? 0, previousByParent.get(parentId) ?? 0, prevComparable, pctFloor),
    )
    .sort((a, b) => b.currentMin - a.currentMin);

  const compared = parentTrends.filter((t) => t.state === "compared" && t.deltaPct !== null);
  const topRising = [...compared]
    .filter((t) => (t.deltaPct ?? 0) > 0)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))
    .slice(0, topN);
  const topFalling = [...compared]
    .filter((t) => (t.deltaPct ?? 0) < 0)
    .sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))
    .slice(0, topN);
  const droppedParents = parentTrends.filter((t) => t.state === "dropped");

  return { window, parentTrends, topRising, topFalling, droppedParents, points, prevComparable };
}
