import type { TimeEntry } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildTimeSlots,
  formatAppDateTime,
  formatDateTimeRange,
  formatMinutesDuration,
  formatMonthDay,
  formatRelativeTime,
  formatTime,
  formatTimelineTimeRange,
  formatYearAwareMonthDay,
  isValidDateString,
  isFutureLocalDateTime,
  resolveClockRangeAroundEndDate,
  rollBackOvernightRange,
  startOfWeek,
  summarizeDay,
  type TimeSlot,
  weekdayIndex,
} from "./time.js";

describe("formatAppDateTime", () => {
  it("formats server UTC timestamps in the app time zone", () => {
    expect(formatAppDateTime("2026-05-05T16:00:00.000Z")).toBe("2026-05-06 00:00:00 UTC+8");
  });
});

describe("formatDateTimeRange", () => {
  it("formats same-day ranges as clock-only", () => {
    expect(formatDateTimeRange("2026-05-08T07:30:00", "2026-05-08T08:15:00")).toBe("07:30 - 08:15");
  });

  it("formats truncated day-end ranges as 24:00", () => {
    expect(formatDateTimeRange("2026-05-07T23:57:00", "2026-05-08T00:00:00", { mode: "truncated" })).toBe(
      "23:57 - 24:00",
    );
  });

  it("formats merged overnight ranges as clock-only", () => {
    expect(formatDateTimeRange("2026-05-07T23:57:00", "2026-05-08T06:00:00", { mode: "merged" })).toBe("23:57 - 06:00");
  });
});

describe("formatTimelineTimeRange", () => {
  it("formats same-day timeline ranges as clock-only", () => {
    expect(formatTimelineTimeRange("2026-05-08T07:30:00", "2026-05-08T08:15:00")).toBe("07:30 - 08:15");
  });

  it("formats cross-day timeline ranges without dates", () => {
    expect(formatTimelineTimeRange("2026-05-08T23:20:00", "2026-05-09T07:00:00")).toBe("23:20 - 07:00");
  });

  it("formats day-end timeline ranges as 24:00", () => {
    expect(formatTimelineTimeRange("2026-05-08T00:07:00", "2026-05-09T00:00:00")).toBe("00:07 - 24:00");
  });
});

describe("isFutureLocalDateTime", () => {
  it("treats values after now as future local times", () => {
    const now = new Date("2026-05-08T08:00:00+08:00");

    expect(isFutureLocalDateTime("2026-05-08T08:01:00", now)).toBe(true);
    expect(isFutureLocalDateTime("2026-05-08T08:00:00", now)).toBe(false);
    expect(isFutureLocalDateTime("2026-05-08T07:59:00", now)).toBe(false);
  });
});

describe("rollBackOvernightRange", () => {
  const now = new Date("2026-06-17T00:14:00+08:00");

  it("解析后 end 比 now 超前 >12h，整段回退一天", () => {
    expect(rollBackOvernightRange("2026-06-17T23:41:00", "2026-06-17T23:50:00", now)).toEqual({
      startTime: "2026-06-16T23:41:00",
      endTime: "2026-06-16T23:50:00",
    });
  });

  it("end 在过去（不晚于 now），不回退", () => {
    expect(rollBackOvernightRange("2026-06-16T23:41:00", "2026-06-17T00:10:00", now)).toEqual({
      startTime: "2026-06-16T23:41:00",
      endTime: "2026-06-17T00:10:00",
    });
  });

  it("end 超前 <=12h 时不回退，保留给上层未来校验拦截", () => {
    const afternoon = new Date("2026-06-20T14:00:00+08:00");
    expect(rollBackOvernightRange("2026-06-20T17:00:00", "2026-06-20T22:00:00", afternoon)).toEqual({
      startTime: "2026-06-20T17:00:00",
      endTime: "2026-06-20T22:00:00",
    });
  });
});

describe("buildTimeSlots", () => {
  // 注意：迁移至 UTC 后，buildTimeSlots 内部边界（dayStart/dayEnd/previousDayContinuationStart）
  // 均为 UTC ISO 字符串。gap slot 的 startTime/endTime 为 UTC；
  // 条目本身的 startTime/endTime 保持原样（已存储格式）。

  it("continues the first gap from the previous entry end when the selected day has no earlier entry", () => {
    const slots = buildTimeSlots([], "2026-05-08", 0, {
      now: "2026-05-08T08:00:00", // 上海 08:00 = UTC 00:00:00.000Z
      previousEntryEndTime: "2026-05-07T23:30:00", // 本地时间，作为 cursor
    });

    expect(slots[0]).toMatchObject({
      startTime: "2026-05-07T23:30:00", // cursor 保持 previousEntryEndTime 原值
      endTime: "2026-05-08T00:00:00.000Z", // dayEnd = UTC（上海 08:00）
      entry: null,
      displayMode: "default",
    });
  });

  it("uses midnight as the end of a past day instead of 23:59:59", () => {
    const slots = buildTimeSlots(
      [
        {
          id: "entry-1",
          categoryId: "sleep",
          startTime: "2026-05-07T23:57:00",
          endTime: "2026-05-08T06:00:00",
          note: null,
          createdAt: "2026-05-07T23:57:00",
          updatedAt: "2026-05-07T23:57:00",
        },
      ],
      "2026-05-07",
      0,
      { now: "2026-05-09T08:00:00" },
    );

    const entrySlot = slots.find((slot) => slot.entry?.id === "entry-1");
    // entrySlot.startTime = entry.startTime（本地）
    // entrySlot.endTime = 被 clip 到 dayEnd = localDateTimeToUtc("2026-05-08T00:00:00") = "2026-05-07T16:00:00.000Z"
    expect(entrySlot).toMatchObject({
      startTime: "2026-05-07T23:57:00",
      endTime: "2026-05-07T16:00:00.000Z", // UTC 下午四点 = 上海 2026-05-08T00:00:00
      displayMode: "truncated",
    });
  });

  it("marks normal same-day entry slots as default display mode", () => {
    const slots = buildTimeSlots(
      [
        {
          id: "entry-1",
          categoryId: "work",
          startTime: "2026-05-08T07:30:00",
          endTime: "2026-05-08T08:00:00",
          note: null,
          createdAt: "2026-05-08T07:30:00",
          updatedAt: "2026-05-08T07:30:00",
        },
      ],
      "2026-05-08",
      0,
      { now: "2026-05-08T09:00:00" },
    );

    const entrySlot = slots.find((slot) => slot.entry?.id === "entry-1");
    expect(entrySlot?.displayMode).toBe("default");
  });

  it("marks gap slots with kind 'gap' and entry slots with kind 'entry'", () => {
    const slots = buildTimeSlots(
      [
        {
          id: "entry-1",
          categoryId: "work",
          startTime: "2026-05-08T07:30:00",
          endTime: "2026-05-08T08:00:00",
          note: null,
          createdAt: "2026-05-08T07:30:00",
          updatedAt: "2026-05-08T07:30:00",
        },
      ],
      "2026-05-08",
      0,
      { now: "2026-05-08T09:00:00" },
    );

    const entrySlot = slots.find((slot) => slot.entry?.id === "entry-1");
    expect(entrySlot?.kind).toBe("entry");

    const gapSlots = slots.filter((slot) => slot.entry === null && slot.kind !== "future");
    expect(gapSlots.length).toBeGreaterThan(0);
    for (const gap of gapSlots) {
      expect(gap.kind).toBe("gap");
    }
  });

  it("merges a previous overnight entry into the selected day when enabled", () => {
    const previousEntry = {
      id: "sleep-1",
      categoryId: "sleep",
      startTime: "2026-05-07T23:57:00",
      endTime: "2026-05-08T06:00:00",
      note: null,
      createdAt: "2026-05-07T23:57:00",
      updatedAt: "2026-05-07T23:57:00",
    };

    const slots = buildTimeSlots([previousEntry], "2026-05-08", 0, {
      now: "2026-05-08T08:00:00",
      previousEntry,
      mergeOvernight: true,
    });

    expect(slots[0]).toMatchObject({
      startTime: "2026-05-07T23:57:00", // previousEntry.startTime 原值
      endTime: "2026-05-08T06:00:00", // previousEntry.endTime 原值
      entry: previousEntry,
      displayMode: "merged",
    });
    expect(slots[1]).toMatchObject({
      startTime: "2026-05-08T06:00:00", // cursor = previousEntry.endTime 原值
      endTime: "2026-05-08T00:00:00.000Z", // dayEnd = UTC（上海 08:00）
      entry: null,
    });
    expect(slots.filter((slot) => slot.entry?.id === previousEntry.id)).toHaveLength(1);
  });

  it("starts the selected day from midnight when the previous entry ended more than four hours before midnight", () => {
    const previousEntry = {
      id: "entry-1",
      categoryId: "misc",
      startTime: "2026-05-07T23:58:00",
      endTime: "2026-05-08T00:07:00",
      note: null,
      createdAt: "2026-05-07T23:58:00",
      updatedAt: "2026-05-07T23:58:00",
    };

    const slots = buildTimeSlots([], "2026-05-09", 0, {
      now: "2026-05-09T12:00:00",
      previousEntry,
      mergeOvernight: true,
    });

    expect(slots[0]).toMatchObject({
      startTime: "2026-05-08T16:00:00.000Z", // dayStart = UTC（上海 2026-05-09T00:00）
      endTime: "2026-05-09T04:00:00.000Z", // dayEnd = UTC（上海 2026-05-09T12:00）
      entry: null,
      displayMode: "default",
    });
  });

  it("continues the first gap from the previous day when the gap to midnight is within four hours", () => {
    const slots = buildTimeSlots([], "2026-05-09", 0, {
      now: "2026-05-09T08:00:00",
      previousEntryEndTime: "2026-05-08T20:30:00",
    });

    expect(slots[0]).toMatchObject({
      startTime: "2026-05-08T20:30:00", // cursor = previousEntryEndTime 原值
      endTime: "2026-05-09T00:00:00.000Z", // dayEnd = UTC（上海 08:00）
      entry: null,
      displayMode: "default",
    });
  });

  it("uses midnight for the first gap when the previous-entry-to-midnight gap is longer than four hours", () => {
    const slots = buildTimeSlots([], "2026-05-09", 0, {
      now: "2026-05-09T08:00:00",
      previousEntryEndTime: "2026-05-08T19:59:00",
    });

    expect(slots[0]).toMatchObject({
      startTime: "2026-05-08T16:00:00.000Z", // dayStart = UTC（上海 2026-05-09T00:00）
      endTime: "2026-05-09T00:00:00.000Z", // dayEnd = UTC（上海 08:00）
      entry: null,
      displayMode: "default",
    });
  });

  it("does not merge a previous overnight entry when disabled", () => {
    const previousEntry = {
      id: "sleep-1",
      categoryId: "sleep",
      startTime: "2026-05-07T23:57:00",
      endTime: "2026-05-08T06:00:00",
      note: null,
      createdAt: "2026-05-07T23:57:00",
      updatedAt: "2026-05-07T23:57:00",
    };

    const slots = buildTimeSlots([], "2026-05-08", 0, {
      now: "2026-05-08T08:00:00",
      previousEntry,
      mergeOvernight: false,
    });

    expect(slots[0]).toMatchObject({
      startTime: "2026-05-07T16:00:00.000Z", // dayStart = UTC（上海 2026-05-08T00:00）
      endTime: "2026-05-08T00:00:00.000Z", // dayEnd = UTC（上海 08:00）
      entry: null,
      displayMode: "default",
    });
  });

  it("appends a future slot from now to 24:00 when date is today", () => {
    const slots = buildTimeSlots([], "2026-05-08", 0, {
      now: "2026-05-08T11:00:00",
    });

    const last = slots[slots.length - 1];
    expect(last?.kind).toBe("future");
    expect(last?.entry).toBeNull();
    expect(last?.startTime).toBe("2026-05-08T03:00:00.000Z");
    expect(last?.endTime).toBe("2026-05-08T16:00:00.000Z");
  });

  it("does not append a future slot for past days", () => {
    const slots = buildTimeSlots([], "2026-05-07", 0, {
      now: "2026-05-08T09:00:00",
    });

    expect(slots.every((slot) => slot.kind !== "future")).toBe(true);
  });
});

describe("formatTime — UTC input", () => {
  it("displays UTC 07:00 as Shanghai 15:00", () => {
    expect(formatTime("2026-05-13T07:00:00.000Z")).toBe("15:00");
  });
  it("displays UTC 16:00 as Shanghai 00:00 (next day)", () => {
    expect(formatTime("2026-05-13T16:00:00.000Z")).toBe("00:00");
  });
});

describe("formatDateTimeRange — UTC input", () => {
  it("shows only time range for same local day entries", () => {
    // UTC 07:00–08:00 = Shanghai 15:00–16:00, same day
    expect(formatDateTimeRange("2026-05-13T07:00:00.000Z", "2026-05-13T08:00:00.000Z")).toBe("15:00 - 16:00");
  });
  it("shows date prefix for cross-day entries in local timezone", () => {
    // UTC 14:00 = Shanghai 22:00 on May 13, UTC 02:00 next day = Shanghai 10:00 on May 14
    const result = formatDateTimeRange("2026-05-13T14:00:00.000Z", "2026-05-14T02:00:00.000Z");
    expect(result).toBe("05-13 22:00 - 05-14 10:00");
  });
});

describe("buildTimeSlots — UTC entries", () => {
  it("places a UTC entry correctly in the local-day timeline", () => {
    const entries: TimeEntry[] = [
      {
        id: "e1",
        categoryId: "c1",
        startTime: "2026-05-14T07:00:00.000Z", // Shanghai 15:00
        endTime: "2026-05-14T08:00:00.000Z", // Shanghai 16:00
        note: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const slots = buildTimeSlots(entries, "2026-05-14", 0, {
      now: new Date("2026-05-14T12:00:00.000Z"), // Shanghai 20:00
    });
    const entrySlot = slots.find((s) => s.entry?.id === "e1");
    expect(entrySlot).toBeDefined();
    // formatTime of the slot's startTime should give 15:00
    expect(formatTime(entrySlot?.startTime)).toBe("15:00");
  });
});

describe("calendar date helpers", () => {
  it("weekdayIndex: 周一为 0、周日为 6", () => {
    // 2026-05-04 是周一，2026-05-08 是周五，2026-05-10 是周日
    expect(weekdayIndex("2026-05-04")).toBe(0);
    expect(weekdayIndex("2026-05-08")).toBe(4);
    expect(weekdayIndex("2026-05-10")).toBe(6);
  });

  it("startOfWeek: 回退到本周周一", () => {
    expect(startOfWeek("2026-05-08")).toBe("2026-05-04");
    expect(startOfWeek("2026-05-04")).toBe("2026-05-04");
    expect(startOfWeek("2026-05-10")).toBe("2026-05-04");
  });

  it("addMonths: 跨年与月末日钳制", () => {
    expect(addMonths("2026-05-08", 1)).toBe("2026-06-08");
    expect(addMonths("2026-05-08", -1)).toBe("2026-04-08");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"); // 2026 非闰年，钳到 28
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28"); // 退月也要钳制
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29"); // 闰年退月
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // 2024 闰年，钳到 29
  });
});

describe("isValidDateString", () => {
  it("接受合法日历日期（含闰日）", () => {
    expect(isValidDateString("2026-07-02")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true);
  });

  it("拒绝格式不符的输入", () => {
    expect(isValidDateString("2026-7-2")).toBe(false);
    expect(isValidDateString("abc")).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });

  it("拒绝解析为 Invalid Date 的月份", () => {
    expect(isValidDateString("2026-13-05")).toBe(false);
    expect(isValidDateString("2026-00-10")).toBe(false);
  });

  it("拒绝会被 V8 静默滚动的日期", () => {
    expect(isValidDateString("2026-02-31")).toBe(false);
    expect(isValidDateString("2023-02-29")).toBe(false);
  });
});

describe("resolveClockRangeAroundEndDate", () => {
  it("end=24:00 解析为锚定日次日 00:00，start 留在锚定日", () => {
    expect(resolveClockRangeAroundEndDate("2026-05-15", "22", "00", "24", "00")).toEqual({
      startTime: "2026-05-15T22:00:00",
      endTime: "2026-05-16T00:00:00",
    });
  });

  it("end=24:00 时 start=00:00 也不回退前一天（整日区间）", () => {
    expect(resolveClockRangeAroundEndDate("2026-05-15", "00", "00", "24", "00")).toEqual({
      startTime: "2026-05-15T00:00:00",
      endTime: "2026-05-16T00:00:00",
    });
  });

  it("常规档位行为不变：end<=start 回退前一天", () => {
    expect(resolveClockRangeAroundEndDate("2026-05-15", "23", "00", "01", "00")).toEqual({
      startTime: "2026-05-14T23:00:00",
      endTime: "2026-05-15T01:00:00",
    });
  });

  it("keeps same-day ranges on the end date when end clock is later", () => {
    expect(resolveClockRangeAroundEndDate("2026-05-08", "07", "30", "08", "15")).toEqual({
      startTime: "2026-05-08T07:30:00",
      endTime: "2026-05-08T08:15:00",
    });
  });

  it("moves the start date to the previous day when end clock is earlier", () => {
    expect(resolveClockRangeAroundEndDate("2026-05-08", "23", "53", "08", "01")).toEqual({
      startTime: "2026-05-07T23:53:00",
      endTime: "2026-05-08T08:01:00",
    });
  });

  it("moves the start date to the previous day when clocks are equal", () => {
    expect(resolveClockRangeAroundEndDate("2026-05-08", "08", "00", "08", "00")).toEqual({
      startTime: "2026-05-07T08:00:00",
      endTime: "2026-05-08T08:00:00",
    });
  });

  it("does not shift dates regardless of where now sits — anchor date is authoritative", () => {
    // 即使 now=2026-05-20T03:00 而 endDate=2026-05-20、endClock=22:00（落在未来），
    // 函数也不再自动推一天；调用方（EntryPage / EntryForm）负责把锚点日期传对。
    expect(resolveClockRangeAroundEndDate("2026-05-20", "09", "00", "22", "00")).toEqual({
      startTime: "2026-05-20T09:00:00",
      endTime: "2026-05-20T22:00:00",
    });
  });
});

describe("formatMinutesDuration", () => {
  it("formats minute-only durations", () => {
    expect(formatMinutesDuration(45)).toBe("45分钟");
  });

  it("formats whole-hour durations without trailing minutes", () => {
    expect(formatMinutesDuration(120)).toBe("2小时");
  });

  it("formats hour-and-minute durations", () => {
    expect(formatMinutesDuration(95)).toBe("1小时35分钟");
  });

  it("clamps negative input to zero", () => {
    expect(formatMinutesDuration(-10)).toBe("0分钟");
  });
});

describe("formatMonthDay", () => {
  it("renders a human month/day label without leading zeros", () => {
    expect(formatMonthDay("2026-06-03")).toBe("6月3日");
  });

  it("handles double-digit month and day", () => {
    expect(formatMonthDay("2026-12-25")).toBe("12月25日");
  });
});

describe("formatYearAwareMonthDay", () => {
  it("当年省略年份", () => {
    expect(formatYearAwareMonthDay("2026-06-03", new Date("2026-06-28T12:00:00.000Z"))).toBe("6月3日");
  });

  it("非当年（去年）补年份前缀", () => {
    expect(formatYearAwareMonthDay("2025-12-31", new Date("2026-06-28T12:00:00.000Z"))).toBe("2025年12月31日");
  });

  it("非当年（明年）补年份前缀", () => {
    expect(formatYearAwareMonthDay("2027-01-01", new Date("2026-06-28T12:00:00.000Z"))).toBe("2027年1月1日");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-02T12:00:00.000Z");

  it("不足 1 分钟显示「刚刚」", () => {
    expect(formatRelativeTime("2026-07-02T11:59:30.000Z", now)).toBe("刚刚");
  });

  it("分钟级", () => {
    expect(formatRelativeTime("2026-07-02T11:30:00.000Z", now)).toBe("30分钟前");
  });

  it("小时级", () => {
    expect(formatRelativeTime("2026-07-02T09:00:00.000Z", now)).toBe("3小时前");
  });

  it("天级", () => {
    expect(formatRelativeTime("2026-06-29T12:00:00.000Z", now)).toBe("3天前");
  });

  it("超过 30 天回退到年份感知日期标签", () => {
    expect(formatRelativeTime("2026-05-01T12:00:00.000Z", now)).toBe("5月1日");
  });

  it("未来时间（时钟偏差）钳为「刚刚」", () => {
    expect(formatRelativeTime("2026-07-02T12:05:00.000Z", now)).toBe("刚刚");
  });

  it("非法输入原样返回", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("not-a-date");
  });
});

describe("summarizeDay", () => {
  function slot(kind: TimeSlot["kind"], startTime: string, endTime: string): TimeSlot {
    return { startTime, endTime, entry: null, kind, displayMode: "default" };
  }

  it("sums recorded and gap minutes and counts segments", () => {
    const slots: TimeSlot[] = [
      slot("entry", "2026-06-03T08:00:00", "2026-06-03T09:00:00"), // 60
      slot("gap", "2026-06-03T09:00:00", "2026-06-03T09:30:00"), // 30
      slot("entry", "2026-06-03T09:30:00", "2026-06-03T10:00:00"), // 30
    ];
    const summary = summarizeDay(slots, "2026-06-03");
    expect(summary.recordedMinutes).toBe(90);
    expect(summary.gapMinutes).toBe(30);
    expect(summary.entryCount).toBe(2);
    expect(summary.gapCount).toBe(1);
    expect(summary.coverageRatio).toBeCloseTo(90 / 120);
  });

  it("ignores future slots so coverage reflects elapsed time only", () => {
    const slots: TimeSlot[] = [
      slot("entry", "2026-06-03T08:00:00", "2026-06-03T09:00:00"),
      slot("future", "2026-06-03T09:00:00", "2026-06-04T00:00:00"),
    ];
    const summary = summarizeDay(slots, "2026-06-03");
    expect(summary.recordedMinutes).toBe(60);
    expect(summary.gapMinutes).toBe(0);
    expect(summary.coverageRatio).toBe(1);
  });

  it("clamps an overnight-merged slot to the selected day", () => {
    // 跨夜睡眠：昨晚 22:00 → 今早 06:00；今天概览只应计入 00:00–06:00 这 6 小时。
    const slots: TimeSlot[] = [
      slot("entry", "2026-06-02T22:00:00", "2026-06-03T06:00:00"),
      slot("gap", "2026-06-03T06:00:00", "2026-06-03T08:00:00"),
    ];
    const summary = summarizeDay(slots, "2026-06-03");
    expect(summary.recordedMinutes).toBe(360);
    expect(summary.gapMinutes).toBe(120);
  });

  it("returns zero coverage for an empty day", () => {
    const summary = summarizeDay([], "2026-06-03");
    expect(summary.recordedMinutes).toBe(0);
    expect(summary.gapMinutes).toBe(0);
    expect(summary.coverageRatio).toBe(0);
  });
});
