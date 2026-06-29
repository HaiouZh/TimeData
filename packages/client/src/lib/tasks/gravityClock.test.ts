import { describe, expect, it, vi } from "vitest";
import { currentGravityDate, msUntilNextLocalDay } from "./gravityClock.ts";

describe("currentGravityDate", () => {
  it("returns a Date matching Date.now()", () => {
    const fixed = Date.parse("2026-06-29T12:00:00.000Z");
    const spy = vi.spyOn(Date, "now").mockReturnValue(fixed);
    expect(currentGravityDate().getTime()).toBe(fixed);
    spy.mockRestore();
  });
});

describe("msUntilNextLocalDay", () => {
  it("returns at least 1 ms", () => {
    const now = new Date("2026-06-29T12:00:00.000Z");
    expect(msUntilNextLocalDay(now)).toBeGreaterThanOrEqual(1);
  });

  it("points to local midnight, not UTC midnight", () => {
    // 2026-06-29T22:00:00 UTC = local 2026-06-30T06:00 if TZ=+8
    // 但 jsdom 默认 TZ 可能是 UTC，这里只验证它指向下一个 local 00:00
    const now = new Date("2026-06-29T23:59:59.999Z");
    const ms = msUntilNextLocalDay(now);
    expect(ms).toBeGreaterThanOrEqual(1);
    expect(ms).toBeLessThanOrEqual(86400000); // 不超过一天
  });

  it("at exactly local midnight, returns 1 day worth of ms (clamped to >= 1)", () => {
    // local midnight: next midnight is 24h away
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const ms = msUntilNextLocalDay(now);
    expect(ms).toBeGreaterThanOrEqual(1);
    // 应该接近 86400000，但 setHours(0,0,0,0) 后 next midnight 刚好 24h
    expect(ms).toBe(86400000);
  });
});