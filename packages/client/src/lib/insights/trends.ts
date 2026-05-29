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

// Task 2 实现。先占位以便 Task 1 类型/窗口可独立测试与编译。
export function buildTrend(
  _entries: TimeEntry[],
  _categories: Category[],
  _window: TrendWindow,
  _options: BuildTrendOptions = {},
): TrendResult {
  void INSIGHT_CONSTANTS;
  void buildDailyRollups;
  throw new Error("buildTrend not implemented yet");
}
