import type { OverviewClusterStatus } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { STAR_KIND_LABELS, statusChipText } from "./overviewGlyphs.js";

describe("overviewGlyphs", () => {
  it.each<[OverviewClusterStatus | null, number | null, string]>([
    ["moving", 0, "在推进"],
    ["saving", 1, "在攒"],
    ["shelved", 12, "搁着 · 12 天"],
    ["fixed", 3, "固定"],
    ["empty", null, "还空着"],
    [null, null, "散着"],
  ])("状态章文案逐字", (status, quietDays, expected) => {
    expect(statusChipText(status, quietDays)).toBe(expected);
  });

  it("四种星的图例文案逐字", () => {
    expect(STAR_KIND_LABELS).toEqual({ input: "你丢的", done: "做完的", progress: "项目进度", recurring: "固定重复" });
  });
});
