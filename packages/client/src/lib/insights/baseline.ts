import { INSIGHT_CONSTANTS } from "./constants.js";

// 线性插值分位。arr 可乱序，空数组返回 null。
export function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface InsightBaselineInput {
  nonSleepSessionDurations: number[]; // 排除睡眠后的会话时长(min)
  awakeGapMins: number[]; // 清醒时段空档(min)
}

export interface InsightBaseline {
  overlongThresholdMin: number; // 超长记录阈值 = max(P95, floor)
  longGapThresholdMin: number; // 长空白阈值
  longGapFromSample: boolean; // 是否来自个人分位（false=回退 fallback）
}

// C2/C5：分位为主，样本不足时退化为固定 floor，避免稀疏数据噪声/漏报。
export function buildInsightBaseline(input: InsightBaselineInput): InsightBaseline {
  const { overlongPercentile, overlongFloorMin, longGapPercentile, longGapMinSample, longGapFallbackMin } =
    INSIGHT_CONSTANTS;

  const p95 = percentile(input.nonSleepSessionDurations, overlongPercentile);
  const overlongThresholdMin = Math.max(p95 ?? 0, overlongFloorMin);

  const gapFromSample = input.awakeGapMins.length >= longGapMinSample;
  const gapPctl = percentile(input.awakeGapMins, longGapPercentile);
  const longGapThresholdMin = gapFromSample && gapPctl !== null ? gapPctl : longGapFallbackMin;

  return { overlongThresholdMin, longGapThresholdMin, longGapFromSample: gapFromSample && gapPctl !== null };
}
