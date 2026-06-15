import type { ChartSeriesRange } from "../healthMetrics/index.ts";

export const HEALTH_RANGE_PRESETS = ["7", "30", "90", "180", "365", "all"] as const;
export type HealthRangePreset = (typeof HEALTH_RANGE_PRESETS)[number];
export const DEFAULT_HEALTH_RANGE_PRESETS: HealthRangePreset[] = [...HEALTH_RANGE_PRESETS];
export const HEALTH_RANGE_PRESETS_KEY = "health.range.presets";

export function parseHealthRangePresets(value: string | null): HealthRangePreset[] {
  if (!value) return [...DEFAULT_HEALTH_RANGE_PRESETS];
  const parsed = value
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is HealthRangePreset => (HEALTH_RANGE_PRESETS as readonly string[]).includes(part));
  return parsed.length > 0 ? parsed : [...DEFAULT_HEALTH_RANGE_PRESETS];
}

export function rangeToChartSeriesRange(preset: HealthRangePreset): ChartSeriesRange {
  return preset === "all" ? { mode: "all" } : { mode: "recent", days: Number(preset) };
}

export function rangeLabel(preset: HealthRangePreset): string {
  return preset === "all" ? "全部" : `${preset}天`;
}
