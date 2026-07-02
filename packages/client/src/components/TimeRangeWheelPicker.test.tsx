import { describe, expect, it } from "vitest";
import { END_HOURS, endMinuteOptions, normalizeEndClockChange } from "./TimeRangeWheelPicker.js";

describe("TimeRangeWheelPicker 24:00 档位", () => {
  it("END_HOURS 是 00..23 加 24", () => {
    expect(END_HOURS).toHaveLength(25);
    expect(END_HOURS[0]).toBe("00");
    expect(END_HOURS.at(-1)).toBe("24");
  });

  it("24 时分钟只有 00 档", () => {
    expect(endMinuteOptions("24")).toEqual(["00"]);
    expect(endMinuteOptions("23")).toHaveLength(60);
  });

  it("拨到 24 时强制分钟归 00，离开 24 保留分钟", () => {
    expect(normalizeEndClockChange({ date: "2026-05-15", hour: "22", minute: "30" }, { hour: "24" })).toEqual({
      date: "2026-05-15",
      hour: "24",
      minute: "00",
    });
    expect(normalizeEndClockChange({ date: "2026-05-15", hour: "24", minute: "00" }, { hour: "23" })).toEqual({
      date: "2026-05-15",
      hour: "23",
      minute: "00",
    });
    expect(normalizeEndClockChange({ date: "2026-05-15", hour: "24", minute: "00" }, { minute: "30" })).toEqual({
      date: "2026-05-15",
      hour: "24",
      minute: "00",
    });
  });
});
