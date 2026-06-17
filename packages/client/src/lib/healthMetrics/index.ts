export type {
  ChartSeriesRange,
  ChartSeriesResult,
  GetChartSeriesOptions,
  HealthMetricCollections,
  HealthMetricId,
  HealthMetricRange,
  HealthSummaryItem,
  HealthSummaryResult,
  HealthTrendMetricId,
  MetricPoint,
  MetricSeries,
  MetricValueType,
  NormalizedHealthTrendPoint,
  NormalizedMetricPoint,
  RunPaceTrendPoint,
} from "./types.js";
export { filterHealthRecordsByRange } from "./range.js";
export {
  computeSleepDurationHours,
  formatClockHours,
  formatDecimalHours,
  formatDistanceKm,
  formatDuration,
  formatIntegerUnit,
  formatNumberUnit,
  formatPace,
  formatRunPace,
  formatRunSummaryPace,
  secondsPerKm,
} from "./format.js";
export { formatMetricValue, getChartSeries } from "./chartSeries.js";
export { findMetricDef, getMetricDef, listMetricDefs, type DailyMetricDef } from "./registry.js";
export { buildHealthSummary } from "./summary.js";
export { buildNormalizedHealthTrend, buildRunPaceTrend } from "./trends.js";
export { normalizeTo100 } from "./normalize.js";
export { aggregateMetricPoints, type MetricAggregateResult } from "./aggregate.js";

export { filterHealthRecordsByRange as filterByDateRange } from "./range.js";
export { computeSleepDurationHours as computeSleepDuration } from "./format.js";
