import type { HealthBlockRange } from "@timedata/shared";
import type { ChartSeriesRange } from "../healthMetrics/index.js";

export function resolveBlockRange(blockRange: HealthBlockRange, pageRange: ChartSeriesRange): ChartSeriesRange {
  return blockRange.mode === "inherit" ? pageRange : blockRange;
}
