import { describe, expect, it } from "vitest";
import { RecurrenceSchema, type Recurrence } from "@timedata/shared";
import { normalizeScheduledDate } from "./placement.js";
import {
  buildPresetRows,
  customToRecurrence,
  isLastDayOfMonth,
  isoWeekdayOf,
  monthdayOf,
  presetToRecurrence,
  recurrenceMatchesPreset,
  recurrenceToCustomInput,
} from "./recurrencePresets.js";

describe("recurrence preset date helpers", () => {
  it("calculates ISO weekday with Monday as 1 and Sunday as 7", () => {
    expect(isoWeekdayOf("2026-06-15")).toBe(1);
    expect(isoWeekdayOf("2026-06-16")).toBe(2);
    expect(isoWeekdayOf("2026-06-21")).toBe(7);
  });

  it("extracts monthday", () => {
    expect(monthdayOf("2026-06-16")).toBe(16);
    expect(monthdayOf("2026-12-01")).toBe(1);
  });

  it("detects month end including leap and non-leap February", () => {
    expect(isLastDayOfMonth("2026-02-28")).toBe(true);
    expect(isLastDayOfMonth("2028-02-29")).toBe(true);
    expect(isLastDayOfMonth("2028-02-28")).toBe(false);
    expect(isLastDayOfMonth("2026-06-29")).toBe(false);
  });
});

describe("presetToRecurrence", () => {
  const anchor = "2026-06-16"; // 周二

  it("builds the five preset recurrences with due basis", () => {
    expect(presetToRecurrence("daily", anchor)).toEqual({ freq: "daily", interval: 1, basis: "due" });
    expect(presetToRecurrence("weekdays", anchor)).toEqual({
      freq: "weekly",
      interval: 1,
      byWeekday: [1, 2, 3, 4, 5],
      basis: "due",
    });
    expect(presetToRecurrence("weekly", anchor)).toEqual({
      freq: "weekly",
      interval: 1,
      byWeekday: [2],
      basis: "due",
    });
    expect(presetToRecurrence("monthly", anchor)).toEqual({
      freq: "monthly",
      interval: 1,
      byMonthday: [16],
      basis: "due",
    });
    expect(presetToRecurrence("monthEnd", anchor)).toEqual({
      freq: "monthly",
      interval: 1,
      byMonthday: [-1],
      basis: "due",
    });
  });
});

describe("recurrenceMatchesPreset", () => {
  it("recognizes common presets", () => {
    expect(recurrenceMatchesPreset(null)).toBe("none");
    expect(recurrenceMatchesPreset({ freq: "daily", interval: 1, basis: "due" })).toBe("daily");
    expect(recurrenceMatchesPreset({ freq: "weekly", interval: 1, basis: "due", byWeekday: [1, 2, 3, 4, 5] })).toBe(
      "weekdays",
    );
    expect(recurrenceMatchesPreset({ freq: "weekly", interval: 1, basis: "due", byWeekday: [2] })).toBe("weekly");
    expect(recurrenceMatchesPreset({ freq: "monthly", interval: 1, basis: "due", byMonthday: [16] })).toBe("monthly");
    expect(recurrenceMatchesPreset({ freq: "monthly", interval: 1, basis: "due", byMonthday: [-1] })).toBe("monthEnd");
  });

  it("classifies complex recurrence rules as custom", () => {
    const customCases: Recurrence[] = [
      { freq: "daily", interval: 2, basis: "due" },
      { freq: "daily", interval: 1, basis: "due", time: "08:30" },
      { freq: "daily", interval: 1, basis: "due", count: 5 },
      { freq: "daily", interval: 1, basis: "due", until: "2026-07-01T00:00:00.000Z" },
      { freq: "daily", interval: 1, basis: "completion" },
      { freq: "weekly", interval: 1, basis: "due", byWeekday: [1, 3] },
      { freq: "monthly", interval: 1, basis: "due", byMonthday: [1, 15] },
      { freq: "monthly", interval: 1, basis: "due", byMonthday: [1, -1] },
    ];

    expect(customCases.map((recurrence) => recurrenceMatchesPreset(recurrence))).toEqual(
      customCases.map(() => "custom"),
    );
  });
});

describe("customToRecurrence", () => {
  it("builds daily, weekly, and monthly recurrence rules from the anchor", () => {
    expect(
      customToRecurrence({ unit: "daily", interval: 2, basis: "completion", start: "2026-06-16", endMode: "never" }),
    ).toEqual({ freq: "daily", interval: 2, basis: "completion" });
    expect(
      customToRecurrence({ unit: "weekly", interval: 1, basis: "due", start: "2026-06-16", endMode: "never" }),
    ).toEqual({ freq: "weekly", interval: 1, basis: "due", byWeekday: [2] });
    expect(
      customToRecurrence({ unit: "monthly", interval: 1, basis: "due", start: "2026-06-16", endMode: "never" }),
    ).toEqual({ freq: "monthly", interval: 1, basis: "due", byMonthday: [16] });
  });

  it("supports month-end recurrence", () => {
    expect(
      customToRecurrence({
        unit: "monthly",
        interval: 1,
        basis: "due",
        start: "2026-06-16",
        monthEnd: true,
        endMode: "never",
      }),
    ).toEqual({ freq: "monthly", interval: 1, basis: "due", byMonthday: [-1] });
  });

  it("keeps count and until mutually exclusive and normalizes until", () => {
    expect(
      customToRecurrence({
        unit: "daily",
        interval: 1,
        basis: "due",
        start: "2026-06-16",
        endMode: "count",
        count: 3,
        until: "2026-07-01",
      }),
    ).toEqual({ freq: "daily", interval: 1, basis: "due", count: 3 });

    expect(
      customToRecurrence({
        unit: "daily",
        interval: 1,
        basis: "due",
        start: "2026-06-16",
        endMode: "until",
        count: 3,
        until: "2026-07-01",
      }),
    ).toEqual({ freq: "daily", interval: 1, basis: "due", until: normalizeScheduledDate("2026-07-01") });
  });

  it("returns rules accepted by the shared schema", () => {
    const parsed = RecurrenceSchema.safeParse(
      customToRecurrence({
        unit: "monthly",
        interval: 1,
        basis: "due",
        start: "2026-06-16",
        endMode: "until",
        until: "2026-07-01",
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("preserves complex hit days while allowing re-anchor when not preserving", () => {
    expect(
      customToRecurrence({
        unit: "weekly",
        interval: 1,
        basis: "due",
        start: "2026-06-16",
        endMode: "never",
        preserveHitDays: true,
        preservedByWeekday: [1, 3],
      }),
    ).toMatchObject({ byWeekday: [1, 3] });

    expect(
      customToRecurrence({
        unit: "weekly",
        interval: 1,
        basis: "due",
        start: "2026-06-16",
        endMode: "never",
        preserveHitDays: false,
        preservedByWeekday: [1, 3],
      }),
    ).toMatchObject({ byWeekday: [2] });
  });

  it("lets monthEnd override preserved monthdays", () => {
    expect(
      customToRecurrence({
        unit: "monthly",
        interval: 1,
        basis: "due",
        start: "2026-06-16",
        endMode: "never",
        monthEnd: true,
        preserveHitDays: true,
        preservedByMonthday: [16, -1],
      }),
    ).toMatchObject({ byMonthday: [-1] });
  });
});

describe("recurrenceToCustomInput", () => {
  it("round-trips a complex weekly recurrence and localizes start/until dates", () => {
    const recurrence: Recurrence = {
      freq: "weekly",
      interval: 2,
      basis: "completion",
      byWeekday: [1, 3],
      time: "08:30",
      count: 5,
    };
    const input = recurrenceToCustomInput(recurrence, normalizeScheduledDate("2026-06-16"), "2026-06-01");

    expect(input).toMatchObject({
      unit: "weekly",
      interval: 2,
      basis: "completion",
      start: "2026-06-16",
      byWeekday: [1, 3],
      preservedByWeekday: [1, 3],
      preserveHitDays: true,
      endMode: "count",
      count: 5,
      time: "08:30",
    });
    expect(customToRecurrence(input)).toEqual(recurrence);
  });

  it("uses fallback start when startAt is null", () => {
    expect(recurrenceToCustomInput({ freq: "daily", interval: 1, basis: "due" }, null, "2026-06-20").start).toBe(
      "2026-06-20",
    );
  });

  it("distinguishes pure month-end from mixed monthdays while preserving arrays", () => {
    const pure = recurrenceToCustomInput(
      { freq: "monthly", interval: 1, basis: "due", byMonthday: [-1] },
      normalizeScheduledDate("2026-06-30"),
      "2026-06-01",
    );
    expect(pure.monthEnd).toBe(true);
    expect(customToRecurrence(pure)).toMatchObject({ byMonthday: [-1] });

    const mixed = recurrenceToCustomInput(
      { freq: "monthly", interval: 1, basis: "due", byMonthday: [1, -1] },
      normalizeScheduledDate("2026-06-30"),
      "2026-06-01",
    );
    expect(mixed.monthEnd).toBe(false);
    expect(mixed.byMonthday).toEqual([1, -1]);
    expect(customToRecurrence(mixed)).toMatchObject({ byMonthday: [1, -1] });
  });

  it("normalizes until back to local date input for round trip", () => {
    const recurrence: Recurrence = {
      freq: "daily",
      interval: 1,
      basis: "due",
      until: normalizeScheduledDate("2026-07-01"),
    };

    const input = recurrenceToCustomInput(recurrence, null, "2026-06-16");

    expect(input).toMatchObject({ endMode: "until", until: "2026-07-01" });
    expect(customToRecurrence(input)).toEqual(recurrence);
  });
});

describe("buildPresetRows", () => {
  it("builds rows in the required order with dynamic labels", () => {
    const rows = buildPresetRows("2026-06-16", null, normalizeScheduledDate("2026-07-01"));

    expect(rows.map((row) => row.key)).toEqual([
      "none",
      "scheduled",
      "daily",
      "weekdays",
      "weekly",
      "monthly",
      "monthEnd",
      "custom",
    ]);
    expect(rows.find((row) => row.key === "weekly")?.label).toBe("每周二");
    expect(rows.find((row) => row.key === "monthly")?.label).toBe("每月16号");
    expect(rows.find((row) => row.key === "scheduled")?.label).toContain("07-01");
  });

  it("marks scheduled, simple preset, custom, and none rows as checked", () => {
    expect(
      buildPresetRows("2026-06-16", null, normalizeScheduledDate("2026-07-01")).find((row) => row.key === "scheduled"),
    ).toMatchObject({ checked: true });
    expect(
      buildPresetRows("2026-06-16", { freq: "weekly", interval: 1, basis: "due", byWeekday: [2] }, null).find(
        (row) => row.key === "weekly",
      ),
    ).toMatchObject({ checked: true });
    expect(
      buildPresetRows("2026-06-16", { freq: "weekly", interval: 1, basis: "due", byWeekday: [1, 3] }, null).find(
        (row) => row.key === "custom",
      ),
    ).toMatchObject({ checked: true });
    expect(buildPresetRows("2026-06-16", null, null).find((row) => row.key === "none")).toMatchObject({
      checked: true,
    });
  });
});
