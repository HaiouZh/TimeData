import { describe, expect, it } from "vitest";
import { CHART_CHROME } from "./chartColors.js";

describe("CHART_CHROME", () => {
  it("镜像中性 token（grid/tick/legend/reference + tooltip + cursor）", () => {
    // 值锁定到 index.css @theme：改动 token 时必须同步镜像，否则此测试失败。
    expect(CHART_CHROME).toEqual({
      grid: "#2b344e", // --color-border
      tick: "#8b94a8", // --color-ink-3
      legend: "#aab4c8", // --color-ink-2
      reference: "#8b94a8", // --color-ink-3
      tooltipBg: "#1b2336", // --color-surface-elevated
      tooltipBorder: "#2b344e", // --color-border
      tooltipText: "#e8edf6", // --color-ink
      tooltipShadow: "0 8px 30px rgba(0,0,0,.4)", // --shadow-elev2
      cursor: "#4f9bf5", // --color-accent
    });
  });
});
