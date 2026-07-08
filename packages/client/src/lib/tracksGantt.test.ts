import { describe, expect, it } from "vitest";
import {
  AFTERGLOW_MS,
  axisTicks,
  clampWindow,
  GANTT_MAX_SPAN_MS,
  GANTT_MIN_SPAN_MS,
  panWindow,
  presetWindow,
  startOfLocalDay,
  timeToX,
  xToMs,
  zoomWindow,
} from "./tracksGantt.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
// 固定"此刻"：2026-07-08T12:00 本地。用本地构造避免时区断言漂移。
const NOW = new Date(2026, 6, 8, 12, 0, 0).getTime();
const MIN_START = startOfLocalDay(NOW - 30 * DAY);

describe("clampWindow", () => {
  it("右缘不越过此刻", () => {
    const w = clampWindow({ startMs: NOW - HOUR, endMs: NOW + HOUR }, NOW, MIN_START);
    expect(w.endMs).toBe(NOW);
    expect(w.endMs - w.startMs).toBe(2 * HOUR);
  });
  it("跨度夹在 [1h, 7d]", () => {
    const tiny = clampWindow({ startMs: NOW - 1000, endMs: NOW }, NOW, MIN_START);
    expect(tiny.endMs - tiny.startMs).toBe(GANTT_MIN_SPAN_MS);
    const huge = clampWindow({ startMs: NOW - 30 * DAY, endMs: NOW }, NOW, MIN_START);
    expect(huge.endMs - huge.startMs).toBe(GANTT_MAX_SPAN_MS);
  });
  it("左缘不越过 minStartMs（窗口整体右移）", () => {
    const w = clampWindow({ startMs: MIN_START - DAY, endMs: MIN_START + HOUR }, NOW, MIN_START);
    expect(w.startMs).toBe(MIN_START);
    expect(w.endMs - w.startMs).toBe(DAY + HOUR);
  });
});

describe("zoomWindow", () => {
  it("锚点时间是缩放不动点", () => {
    const w = { startMs: NOW - 4 * HOUR, endMs: NOW - 2 * HOUR };
    const anchorRatio = 0.25;
    const anchorT = w.startMs + anchorRatio * (w.endMs - w.startMs);
    const zoomed = zoomWindow(w, anchorRatio, 0.5, NOW, MIN_START);
    const anchorAfter = zoomed.startMs + anchorRatio * (zoomed.endMs - zoomed.startMs);
    expect(Math.abs(anchorAfter - anchorT)).toBeLessThan(1);
    expect(zoomed.endMs - zoomed.startMs).toBe(HOUR);
  });
  it("放大到底 clamp 到 1h", () => {
    const w = { startMs: NOW - HOUR, endMs: NOW };
    const zoomed = zoomWindow(w, 0.5, 0.01, NOW, MIN_START);
    expect(zoomed.endMs - zoomed.startMs).toBe(GANTT_MIN_SPAN_MS);
  });
});

describe("panWindow", () => {
  it("向右平移被此刻挡住", () => {
    const w = { startMs: NOW - 2 * HOUR, endMs: NOW - HOUR };
    const panned = panWindow(w, 5 * HOUR, NOW, MIN_START);
    expect(panned.endMs).toBe(NOW);
  });
  it("向左平移被 minStartMs 挡住", () => {
    const w = { startMs: MIN_START + HOUR, endMs: MIN_START + 3 * HOUR };
    const panned = panWindow(w, -5 * HOUR, NOW, MIN_START);
    expect(panned.startMs).toBe(MIN_START);
  });
});

describe("presetWindow", () => {
  it("today = 本地零点到此刻", () => {
    const w = presetWindow("today", NOW);
    expect(w.startMs).toBe(startOfLocalDay(NOW));
    expect(w.endMs).toBe(NOW);
  });
  it("凌晨的 today 保底 1h 跨度", () => {
    const earlyNow = startOfLocalDay(NOW) + 10 * 60_000; // 00:10
    const w = presetWindow("today", earlyNow);
    expect(w.endMs - w.startMs).toBe(GANTT_MIN_SPAN_MS);
  });
  it("3d / 7d 右缘=此刻", () => {
    expect(presetWindow("3d", NOW)).toEqual({ startMs: NOW - 3 * DAY, endMs: NOW });
    expect(presetWindow("7d", NOW)).toEqual({ startMs: NOW - 7 * DAY, endMs: NOW });
  });
});

describe("timeToX / xToMs 互逆", () => {
  it("往返一致", () => {
    const w = { startMs: NOW - DAY, endMs: NOW };
    expect(timeToX(w, 800, NOW)).toBe(800);
    expect(timeToX(w, 800, NOW - DAY)).toBe(0);
    expect(Math.abs(xToMs(w, 800, timeToX(w, 800, NOW - 5 * HOUR)) - (NOW - 5 * HOUR))).toBeLessThan(1);
  });
});

describe("axisTicks", () => {
  it("6h 窗口出小时刻度，标签 HH:00", () => {
    const w = { startMs: NOW - 6 * HOUR, endMs: NOW };
    const ticks = axisTicks(w);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(9);
    expect(ticks.every((t) => t.tMs >= w.startMs && t.tMs <= w.endMs)).toBe(true);
    expect(ticks.some((t) => /^\d{2}:00$/.test(t.label))).toBe(true);
  });
  it("7d 窗口出天刻度，标签 M/D", () => {
    const w = { startMs: NOW - 7 * DAY, endMs: NOW };
    const ticks = axisTicks(w);
    expect(ticks.every((t) => /^\d{1,2}\/\d{1,2}$/.test(t.label))).toBe(true);
  });
  it("跨午夜的小时刻度里零点显示日期", () => {
    const w = { startMs: startOfLocalDay(NOW) - 3 * HOUR, endMs: startOfLocalDay(NOW) + 3 * HOUR };
    const ticks = axisTicks(w);
    const midnight = ticks.find((t) => t.tMs === startOfLocalDay(NOW));
    expect(midnight?.label).toMatch(/^\d{1,2}\/\d{1,2}$/);
  });
});

describe("常量", () => {
  it("余晖 2 小时", () => {
    expect(AFTERGLOW_MS).toBe(2 * HOUR);
  });
});
