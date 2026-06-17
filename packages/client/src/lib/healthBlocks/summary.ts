import type { HealthAggregation } from "@timedata/shared";
import {
  aggregateMetricPoints,
  findMetricDef,
  formatMetricValue,
  getChartSeries,
  type ChartSeriesRange,
  type HealthMetricCollections,
} from "../healthMetrics/index.js";

export type HealthSummaryTone = "sleep" | "hrv" | "heart" | "stress" | "run";

export interface HealthSummaryCardItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: HealthSummaryTone;
}

const AGGREGATION_LABEL: Record<HealthAggregation, string> = {
  latest: "最新",
  avg: "均值",
  max: "最大",
  min: "最小",
  sum: "合计",
};

function toneFromMetricId(metricId: string): HealthSummaryTone {
  if (metricId.startsWith("sleep.")) return "sleep";
  if (metricId.startsWith("hrv.")) return "hrv";
  if (metricId.startsWith("heart_rate.")) return "heart";
  if (metricId.startsWith("stress.")) return "stress";
  return "run";
}

function mmdd(date: string): string {
  return date.slice(5);
}

function rangeLabel(range: ChartSeriesRange, from: string, to: string): string {
  if (range.mode === "recent") return `近${range.days}日`;
  return `${mmdd(from)}~${mmdd(to)}`;
}

export function buildMetricCardItems(
  collections: HealthMetricCollections,
  metricIds: readonly string[],
  range: ChartSeriesRange,
  aggregation: HealthAggregation,
): HealthSummaryCardItem[] {
  const items: HealthSummaryCardItem[] = [];
  for (const metricId of metricIds) {
    const def = findMetricDef(metricId);
    if (!def) continue;
    const { series, from, to } = getChartSeries({ metricIds: [metricId], rollingWindows: [], range }, collections);
    const points = series[0]?.points ?? [];
    const { value, date } = aggregateMetricPoints(points, aggregation);
    const aggLabel = AGGREGATION_LABEL[aggregation];

    let detail: string;
    if (value == null) {
      detail = "暂无数据";
    } else if (aggregation === "avg" || aggregation === "sum") {
      detail = `${aggLabel}·${rangeLabel(range, from, to)}`;
    } else {
      detail = `${aggLabel}·${date != null ? mmdd(date) : rangeLabel(range, from, to)}`;
    }

    items.push({
      id: metricId,
      label: def.label,
      value: value == null ? "--" : formatMetricValue(def, value),
      detail,
      tone: toneFromMetricId(metricId),
    });
  }
  return items;
}
