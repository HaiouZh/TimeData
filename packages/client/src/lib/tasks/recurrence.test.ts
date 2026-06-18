import { describe, it, expect } from "vitest";
import {
  currentDueDateString,
  formatCreatedAt,
  isDueNow,
  isRecurrenceFinishedAfter,
  recurrenceSummary,
} from "./recurrence.js";
import type { Recurrence } from "@timedata/shared";

const daily = (over: Partial<Recurrence> = {}): Recurrence => ({ freq: "daily", interval: 1, basis: "due", ...over });

describe("isDueNow daily", () => {
  const start = "2026-06-01T00:00:00.000Z";
  it("due when never done", () => {
    expect(isDueNow(daily(), null, start, new Date("2026-06-10T08:00:00.000Z"))).toBe(true);
  });
  it("not due when already done today (due basis)", () => {
    expect(isDueNow(daily(), "2026-06-10T12:00:00.000Z", start, new Date("2026-06-10T08:00:00.000Z"))).toBe(false);
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
  it("carries an overdue month-end occurrence forward", () => {
    const r: Recurrence = { freq: "monthly", interval: 1, byMonthday: [-1], basis: "due" };
    const start = "2026-01-01T00:00:00.000Z";
    // 1/31(月末)未完成，到 2/10 仍 due（逾期顺延，lastScheduledDay=Jan31）
    expect(isDueNow(r, null, start, new Date("2026-02-10T12:00:00.000Z"))).toBe(true);
  });
});

describe("isDueNow completion basis", () => {
  it("next from last done, not calendar", () => {
    const r: Recurrence = { freq: "daily", interval: 3, basis: "completion" };
    expect(isDueNow(r, "2026-06-06T00:00:00.000Z", "2026-06-01T00:00:00.000Z", new Date("2026-06-08T00:00:00.000Z"))).toBe(false);
    expect(isDueNow(r, "2026-06-06T00:00:00.000Z", "2026-06-01T00:00:00.000Z", new Date("2026-06-09T00:00:00.000Z"))).toBe(true);
  });
  it("completion basis weekly: next from last done", () => {
    const r: Recurrence = { freq: "weekly", interval: 1, byWeekday: [1, 3, 5], basis: "completion" };
    const start = "2026-06-01T00:00:00.000Z";
    // 上次周五(06-05)完成，下一个计划日是周一(06-08)
    expect(isDueNow(r, "2026-06-05T12:00:00.000Z", start, new Date("2026-06-07T12:00:00.000Z"))).toBe(false);
    expect(isDueNow(r, "2026-06-05T12:00:00.000Z", start, new Date("2026-06-08T12:00:00.000Z"))).toBe(true);
  });
  it("completion basis monthly: next month after completion", () => {
    const r: Recurrence = { freq: "monthly", interval: 1, byMonthday: [15], basis: "completion" };
    const start = "2026-01-01T00:00:00.000Z";
    // 上次 03-15 完成，下次 04-15
    expect(isDueNow(r, "2026-03-15T12:00:00.000Z", start, new Date("2026-04-14T12:00:00.000Z"))).toBe(false);
    expect(isDueNow(r, "2026-03-15T12:00:00.000Z", start, new Date("2026-04-15T12:00:00.000Z"))).toBe(true);
  });
});

describe("isDueNow before start", () => {
  it("is not due when now is before startAt", () => {
    const start = "2026-06-01T00:00:00.000Z";
    expect(isDueNow({ freq: "daily", interval: 1, basis: "due" }, null, start, new Date("2026-05-20T12:00:00.000Z"))).toBe(false);
    expect(isDueNow({ freq: "weekly", interval: 1, byWeekday: [1], basis: "due" }, null, start, new Date("2026-05-20T12:00:00.000Z"))).toBe(false);
  });
});

describe("recurrence display helpers", () => {
  it("summarizes recurrence rules", () => {
    expect(recurrenceSummary({ freq: "daily", interval: 2, basis: "due", time: "06:30" })).toBe("每2天 06:30");
    expect(recurrenceSummary({ freq: "weekly", interval: 1, byWeekday: [1, 3], basis: "due" })).toBe("每周周一周三");
    expect(recurrenceSummary({ freq: "monthly", interval: 1, byMonthday: [1, -1], basis: "due" })).toBe("每月1号、最后一天");
  });

  it("formatCreatedAt 显示本地日期", () => {
    expect(formatCreatedAt("2026-06-14T00:00:00.000Z")).toMatch(/创建于 \d{2}-\d{2}/);
  });
});

describe("until 截止", () => {
  const start = "2026-06-01T00:00:00.000Z";

  it("到期日晚于 until → 不再到期", () => {
    const r = { freq: "daily", interval: 1, basis: "due", until: "2026-06-10T00:00:00.000Z" } as const;
    expect(isDueNow(r, null, start, new Date("2026-06-15T08:00:00.000Z"))).toBe(false);
  });

  it("until 之内仍到期", () => {
    const r = { freq: "daily", interval: 1, basis: "due", until: "2026-06-20T00:00:00.000Z" } as const;
    expect(isDueNow(r, null, start, new Date("2026-06-15T08:00:00.000Z"))).toBe(true);
  });
});

describe("isRecurrenceFinishedAfter", () => {
  const start = "2026-06-01T00:00:00.000Z";

  it("完成后的下一发生日越过 until → true", () => {
    const r = { freq: "daily", interval: 1, basis: "due", until: "2026-06-15T00:00:00.000Z" } as const;
    expect(isRecurrenceFinishedAfter(r, start, new Date("2026-06-15T09:00:00.000Z"))).toBe(true);
  });

  it("还有后续发生 → false", () => {
    const r = { freq: "daily", interval: 1, basis: "due", until: "2026-06-20T00:00:00.000Z" } as const;
    expect(isRecurrenceFinishedAfter(r, start, new Date("2026-06-15T09:00:00.000Z"))).toBe(false);
  });

  it("无 until → false", () => {
    const r = { freq: "daily", interval: 1, basis: "due" } as const;
    expect(isRecurrenceFinishedAfter(r, start, new Date("2026-06-15T09:00:00.000Z"))).toBe(false);
  });
});

describe("recurrenceSummary 终止文案", () => {
  it("count", () => {
    expect(recurrenceSummary({ freq: "daily", interval: 1, basis: "due", count: 12 })).toBe("每天·共12次");
  });

  it("until", () => {
    expect(recurrenceSummary({ freq: "daily", interval: 1, basis: "due", until: "2026-07-31T00:00:00.000Z" })).toBe("每天·至07-31");
  });
});

describe("currentDueDateString", () => {
  it("每日重复：lastDone 次日为当前到期日", () => {
    const r = { freq: "daily", interval: 1, basis: "due" } as const;
    expect(
      currentDueDateString(r, "2026-06-15T12:00:00.000Z", "2026-06-01T12:00:00.000Z"),
    ).toBe("2026-06-16");
  });

  it("无 lastDone：当前到期日 = startAt 当天", () => {
    const r = { freq: "daily", interval: 1, basis: "due" } as const;
    expect(currentDueDateString(r, null, "2026-06-10T12:00:00.000Z")).toBe("2026-06-10");
  });
});
