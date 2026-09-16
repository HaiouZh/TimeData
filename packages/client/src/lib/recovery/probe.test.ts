import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../storageKeys.js";

describe("readColdStartCause", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 逃逸变异：不备忘 → markFirstPaint 消费墓碑后再算，看门狗自救重载被算成 external，冷启动会话与 cold_start 对不上。
  it("markFirstPaint 消费墓碑之后再读，仍是同一个归因", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { type: "reload", domContentLoadedEventEnd: 120 },
    ] as unknown as PerformanceEntryList);
    localStorage.setItem(STORAGE_KEYS.reloadTombstone, JSON.stringify({ at: Date.now(), by: "watchdog" }));
    const probe = await import("./probe.js");
    probe.markFirstPaint();
    expect(localStorage.getItem(STORAGE_KEYS.reloadTombstone)).toBeNull();
    expect(probe.readColdStartCause()).toBe("watchdog");
  });

  it("没有导航条目 → null", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    const probe = await import("./probe.js");
    expect(probe.readColdStartCause()).toBeNull();
  });
});
