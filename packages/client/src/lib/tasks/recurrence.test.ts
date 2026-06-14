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
