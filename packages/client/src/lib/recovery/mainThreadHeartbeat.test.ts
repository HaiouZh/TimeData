import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat } from "./mainThreadHeartbeat.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startHeartbeat", () => {
  it("线程空闲时每拍准点，最大迟到为 0", () => {
    const hb = startHeartbeat(250);
    vi.advanceTimersByTime(250 * 8);
    expect(hb.maxGapMs()).toBe(0);
    hb.stop();
  });

  // 真闸：模拟主线程被冻 8 秒——挂钟走了、定时器没跑——心跳必须把这 8 秒量出来。
  it("中间被冻过一段，量出那段的迟到", () => {
    const hb = startHeartbeat(250);
    vi.advanceTimersByTime(250 * 2);
    vi.setSystemTime(Date.now() + 8000); // 挂钟跳过 8 秒，下一拍才跑
    vi.advanceTimersByTime(250);
    expect(hb.maxGapMs()).toBeGreaterThanOrEqual(8000);
    expect(hb.maxGapMs()).toBeLessThan(8000 + 250);
    hb.stop();
  });

  it("上一拍到查询那一刻的这段也算——判定时刻正冻着不会漏", () => {
    const hb = startHeartbeat(250);
    vi.advanceTimersByTime(250);
    vi.setSystemTime(Date.now() + 3000); // 没有再跑任何一拍
    expect(hb.maxGapMs()).toBeGreaterThanOrEqual(3000 - 250);
    hb.stop();
  });

  it("stop 之后不再跳，也不再累加", () => {
    const hb = startHeartbeat(250);
    hb.stop();
    vi.setSystemTime(Date.now() + 5000);
    vi.advanceTimersByTime(250 * 4);
    expect(hb.maxGapMs()).toBe(0);
  });
});
