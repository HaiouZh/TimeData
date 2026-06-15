import { describe, expect, it } from "vitest";
import { DEFAULT_HEALTH_RANGE_PRESETS, parseHealthRangePresets, rangeToChartSeriesRange } from "./healthRangeSetting.js";

describe("healthRangeSetting", () => {
  it("缺省给全集", () => {
    expect(parseHealthRangePresets(null)).toEqual(DEFAULT_HEALTH_RANGE_PRESETS);
  });

  it("解析逗号串并过滤非法档", () => {
    expect(parseHealthRangePresets("7,foo,90,all")).toEqual(["7", "90", "all"]);
  });

  it("空串回退缺省", () => {
    expect(parseHealthRangePresets("")).toEqual(DEFAULT_HEALTH_RANGE_PRESETS);
  });

  it("preset 转 ChartSeriesRange", () => {
    expect(rangeToChartSeriesRange("all")).toEqual({ mode: "all" });
    expect(rangeToChartSeriesRange("30")).toEqual({ mode: "recent", days: 30 });
  });
});
