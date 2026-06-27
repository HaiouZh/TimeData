import { describe, expect, it } from "vitest";
import { CHART_CHROME, DATA_PALETTE, metricColor } from "./chartColors.js";

describe("metricColor", () => {
  it("按指标前缀给语义色", () => {
    expect(metricColor("sleep.duration", new Set())).toBe(DATA_PALETTE.green);
    expect(metricColor("hrv.rmssd", new Set())).toBe(DATA_PALETTE.teal);
    expect(metricColor("heart_rate.resting", new Set())).toBe(DATA_PALETTE.red);
    expect(metricColor("stress.avg", new Set())).toBe(DATA_PALETTE.amber);
    expect(metricColor("run.pace", new Set())).toBe(DATA_PALETTE.blue);
  });

  it("未知指标兜底蓝", () => {
    expect(metricColor("weird.metric", new Set())).toBe(DATA_PALETTE.blue);
  });

  it("同图同语义碰撞时退到剩余色且确定性", () => {
    const claimed = new Set<string>();
    expect(metricColor("sleep.duration", claimed)).toBe(DATA_PALETTE.green);
    // 第二条睡眠线：绿已占 → 退到 PALETTE_ORDER 首个未占色
    expect(metricColor("sleep.deep", claimed)).toBe(DATA_PALETTE.blue);
    expect(claimed.has(DATA_PALETTE.green)).toBe(true);
    expect(claimed.has(DATA_PALETTE.blue)).toBe(true);
  });

  it("CHART_CHROME 镜像中性 token（grid/tick/legend/reference + tooltip + cursor）", () => {
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
