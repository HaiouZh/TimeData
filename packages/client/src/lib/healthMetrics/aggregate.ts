import type { HealthAggregation } from "@timedata/shared";
import type { MetricPoint } from "./types.js";

export interface MetricAggregateResult {
  value: number | null;
  date: string | null;
}

export function aggregateMetricPoints(
  points: readonly MetricPoint[],
  aggregation: HealthAggregation,
): MetricAggregateResult {
  const valued = points.filter(
    (point): point is MetricPoint & { value: number } => point.value != null && Number.isFinite(point.value),
  );
  if (valued.length === 0) return { value: null, date: null };

  if (aggregation === "latest") {
    const last = valued[valued.length - 1];
    return { value: last.value, date: last.date };
  }
  if (aggregation === "avg") {
    const sum = valued.reduce((acc, point) => acc + point.value, 0);
    return { value: sum / valued.length, date: null };
  }
  if (aggregation === "sum") {
    const sum = valued.reduce((acc, point) => acc + point.value, 0);
    return { value: sum, date: null };
  }

  let best = valued[0];
  for (const point of valued) {
    if (aggregation === "max" ? point.value > best.value : point.value < best.value) best = point;
  }
  return { value: best.value, date: best.date };
}
