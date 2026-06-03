import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.ts";
import { DEFAULT_TREND_CONFIG, sanitizeTrendConfig } from "./statsModuleTrendSetting.ts";

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("sanitizeTrendConfig", () => {
  it("null 回退默认（preset 7 天 + line）", () => {
    expect(sanitizeTrendConfig(null)).toEqual(DEFAULT_TREND_CONFIG);
  });

  it("保留合法 preset", () => {
    const out = sanitizeTrendConfig({ window: { kind: "preset", days: 30 }, chart: "area" });
    expect(out).toEqual({ window: { kind: "preset", days: 30 }, chart: "area" });
  });

  it("非法 window kind 回退默认 window", () => {
    const out = sanitizeTrendConfig({ window: { kind: "bogus" }, chart: "line" });
    expect(out.window).toEqual(DEFAULT_TREND_CONFIG.window);
  });

  it("非法 chart 回退 line", () => {
    const out = sanitizeTrendConfig({ window: { kind: "preset", days: 7 }, chart: "pie" });
    expect(out.chart).toBe("line");
  });

  it("customRange 校验 from/to 为字符串", () => {
    const out = sanitizeTrendConfig({
      window: { kind: "customRange", from: "2026-01-01", to: "2026-01-07" },
      chart: "line",
    });
    expect(out.window).toEqual({ kind: "customRange", from: "2026-01-01", to: "2026-01-07" });
  });
});
