import { describe, it, expect } from "vitest";
import { isDueNow } from "./recurrence.js";
import type { Recurrence } from "@timedata/shared";

const daily = (over: Partial<Recurrence> = {}): Recurrence => ({ freq: "daily", interval: 1, basis: "due", ...over });

describe("isDueNow daily", () => {
  const start = "2026-06-01T00:00:00.000Z";
  it("due when never done", () => {
    expect(isDueNow(daily(), null, start, new Date("2026-06-10T08:00:00.000Z"))).toBe(true);
  });
  it("not due when already done today (due basis)", () => {
    expect(isDueNow(daily(), "2026-06-10T07:00:00.000Z", start, new Date("2026-06-10T08:00:00.000Z"))).toBe(false);
  });
  it("due again next day", () => {
    expect(isDueNow(daily(), "2026-06-10T07:00:00.000Z", start, new Date("2026-06-11T06:00:00.000Z"))).toBe(true);
  });
  it("every 3 days (due basis) only due on schedule days", () => {
    const r = daily({ interval: 3 });
    expect(isDueNow(r, null, start, new Date("2026-06-04T00:00:00.000Z"))).toBe(true);
    expect(isDueNow(r, "2026-06-04T00:00:00.000Z", start, new Date("2026-06-05T00:00:00.000Z"))).toBe(false);
    expect(isDueNow(r, "2026-06-04T00:00:00.000Z", start, new Date("2026-06-07T00:00:00.000Z"))).toBe(true);
  });
});

describe("isDueNow weekly", () => {
  const start = "2026-06-01T00:00:00.000Z"; // 2026-06-01 是周一
  const monWedFri = (): Recurrence => ({ freq: "weekly", interval: 1, byWeekday: [1, 3, 5], basis: "due" });
  it("due on a configured weekday when not done", () => {
    expect(isDueNow(monWedFri(), null, start, new Date("2026-06-03T09:00:00.000Z"))).toBe(true);
  });
  it("not due on a non-configured weekday", () => {
    expect(isDueNow(monWedFri(), "2026-06-01T00:00:00.000Z", start, new Date("2026-06-02T09:00:00.000Z"))).toBe(false);
  });
  it("every 2 weeks respects the off week", () => {
    const r: Recurrence = { freq: "weekly", interval: 2, byWeekday: [1], basis: "due" };
    expect(isDueNow(r, null, start, new Date("2026-06-08T00:00:00.000Z"))).toBe(false);
    expect(isDueNow(r, null, start, new Date("2026-06-15T00:00:00.000Z"))).toBe(true);
  });
});
