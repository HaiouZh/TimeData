import { describe, it, expect } from "vitest";
import { RecurrenceSchema, TaskSchema } from "./entitySchemas.js";

describe("RecurrenceSchema", () => {
  const base = { interval: 1, basis: "due" as const };
  it("accepts daily", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily" }).success).toBe(true);
  });
  it("requires byWeekday for weekly", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly" }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly", byWeekday: [1, 3, 5] }).success).toBe(true);
  });
  it("requires byMonthday for monthly and allows -1 (month end)", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly" }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly", byMonthday: [1, 15, -1] }).success).toBe(true);
  });
  it("rejects byWeekday on daily", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", byWeekday: [1] }).success).toBe(false);
  });
  it("rejects byWeekday out-of-range [8]", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly", byWeekday: [8] }).success).toBe(false);
  });
  it("rejects byMonthday out-of-range [0]", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly", byMonthday: [0] }).success).toBe(false);
  });
  it("rejects mismatched freq/by-field combinations", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "weekly", byWeekday: [1], byMonthday: [15] }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "monthly", byMonthday: [1], byWeekday: [1] }).success).toBe(false);
  });
  it("rejects non-positive interval", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", interval: 0 }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", interval: -1 }).success).toBe(false);
  });
  it("validates time format", () => {
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", time: "06:30" }).success).toBe(true);
    expect(RecurrenceSchema.safeParse({ ...base, freq: "daily", time: "6:30" }).success).toBe(false);
  });
});

describe("TaskSchema", () => {
  const t = {
    id: "t1", title: "跑步", done: false, recurrence: null,
    lastDoneAt: null, startAt: null, sortOrder: 0,
    createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z",
  };
  it("accepts a pool task", () => {
    expect(TaskSchema.safeParse(t).success).toBe(true);
  });
  it("rejects empty title", () => {
    expect(TaskSchema.safeParse({ ...t, title: "  " }).success).toBe(false);
  });
  it("accepts a recurring task", () => {
    expect(TaskSchema.safeParse({
      ...t, recurrence: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due", time: "06:00" },
    }).success).toBe(true);
  });
});
