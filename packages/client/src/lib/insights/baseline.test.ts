import { describe, expect, it } from "vitest";
import { buildInsightBaseline, percentile } from "./baseline.js";

describe("percentile", () => {
  it("线性插值分位", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10], 0.95)).toBe(10);
  });
  it("空数组返回 null", () => {
    expect(percentile([], 0.5)).toBeNull();
  });
  it("p=0 返回最小值，p=1 返回最大值", () => {
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([5, 1, 3], 1)).toBe(5);
  });
});

describe("buildInsightBaseline", () => {
  it("超长记录 P95 排除睡眠分类后计算", () => {
    const sessionDurations = [60, 60, 60, 60, 60, 60, 60, 60, 60, 600];
    const baseline = buildInsightBaseline({ nonSleepSessionDurations: sessionDurations, awakeGapMins: [] });
    // P95 = sorted[8] + (sorted[9]-sorted[8])*(9*0.95-8) = 60 + 540*0.55 = 357；max(357,180)=357
    expect(baseline.overlongThresholdMin).toBeCloseTo(357, 5);
  });

  it("nonSleepSessionDurations 为空时 overlong 阈值等于 floor", () => {
    const baseline = buildInsightBaseline({ nonSleepSessionDurations: [], awakeGapMins: [] });
    expect(baseline.overlongThresholdMin).toBe(180);
  });

  it("清醒空档样本充足用 P90；不足回退 fallback", () => {
    const enough = Array.from({ length: 12 }, (_, i) => (i + 1) * 30); // n=12 >= 10
    const baselineEnough = buildInsightBaseline({ nonSleepSessionDurations: [], awakeGapMins: enough });
    expect(baselineEnough.longGapThresholdMin).toBe(percentile(enough, 0.9));
    expect(baselineEnough.longGapFromSample).toBe(true);

    const few = [30, 311]; // n=2 < 10
    const baselineFew = buildInsightBaseline({ nonSleepSessionDurations: [], awakeGapMins: few });
    expect(baselineFew.longGapThresholdMin).toBe(90); // fallback
    expect(baselineFew.longGapFromSample).toBe(false);
  });

  it("恰好 n=10 走分位（边界，>= 非 >）", () => {
    const exactly = Array.from({ length: 10 }, (_, i) => (i + 1) * 30); // n=10
    const baseline = buildInsightBaseline({ nonSleepSessionDurations: [], awakeGapMins: exactly });
    expect(baseline.longGapThresholdMin).toBe(percentile(exactly, 0.9));
    expect(baseline.longGapFromSample).toBe(true);
  });
});
