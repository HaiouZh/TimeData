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
    // 第 0 周一已完成 → 第 1 周（off）不再 due
    expect(isDueNow(r, "2026-06-01T00:00:00.000Z", start, new Date("2026-06-08T00:00:00.000Z"))).toBe(false);
    // 第 2 周一（on）未完成 → due
    expect(isDueNow(r, "2026-06-01T00:00:00.000Z", start, new Date("2026-06-15T00:00:00.000Z"))).toBe(true);
  });
  it("carries an overdue occurrence forward (due basis)", () => {
    const r: Recurrence = { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" };
    // 周一(06-01)未完成，到周三(06-03)仍应 due（逾期顺延）
    expect(isDueNow(r, null, start, new Date("2026-06-03T00:00:00.000Z"))).toBe(true);
  });
});

describe("isDueNow monthly", () => {
  const start = "2026-01-01T00:00:00.000Z";
  it("due on configured day-of-month", () => {
    const r: Recurrence = { freq: "monthly", interval: 1, byMonthday: [15], basis: "due" };
    expect(isDueNow(r, null, start, new Date("2026-03-15T00:00:00.000Z"))).toBe(true);
    expect(isDueNow(r, "2026-03-15T00:00:00.000Z", start, new Date("2026-03-16T00:00:00.000Z"))).toBe(false);
  });
  it("-1 resolves to last day of month (Feb leap year = 29)", () => {
    const r: Recurrence = { freq: "monthly", interval: 1, byMonthday: [-1], basis: "due" };
    expect(isDueNow(r, null, start, new Date("2028-02-29T00:00:00.000Z"))).toBe(true);
    expect(isDueNow(r, null, start, new Date("2026-02-28T00:00:00.000Z"))).toBe(true);
  });
  it("skips months without the configured day (31)", () => {
    const r: Recurrence = { freq: "monthly", interval: 1, byMonthday: [31], basis: "due" };
    // 3/31 已完成；4 月没有 31 号 → 4/30 不是计划日，不 due
    expect(isDueNow(r, "2026-03-31T00:00:00.000Z", start, new Date("2026-04-30T00:00:00.000Z"))).toBe(false);
    // 5/31 未完成 → due
    expect(isDueNow(r, "2026-03-31T00:00:00.000Z", start, new Date("2026-05-31T00:00:00.000Z"))).toBe(true);
  });
});

describe("isDueNow completion basis", () => {
  it("next from last done, not calendar", () => {
    const r: Recurrence = { freq: "daily", interval: 3, basis: "completion" };
    expect(isDueNow(r, "2026-06-06T00:00:00.000Z", "2026-06-01T00:00:00.000Z", new Date("2026-06-08T00:00:00.000Z"))).toBe(false);
    expect(isDueNow(r, "2026-06-06T00:00:00.000Z", "2026-06-01T00:00:00.000Z", new Date("2026-06-09T00:00:00.000Z"))).toBe(true);
  });
});
