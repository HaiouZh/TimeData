import { describe, expect, it } from "vitest";
import { formatAxisPace, formatClockHours, formatNumberUnit } from "./format.js";

describe("formatClockHours", () => {
  it("整点与半点渲染成 HH:MM", () => {
    expect(formatClockHours(22.5)).toBe("22:30");
    expect(formatClockHours(6)).toBe("06:00");
  });

  it(">=24 取模回到当天时钟", () => {
    expect(formatClockHours(25.5)).toBe("01:30");
  });

  it("null 返回占位", () => {
    expect(formatClockHours(null)).toBe("--");
  });
});

describe("formatNumberUnit", () => {
  it("带单位", () => {
    expect(formatNumberUnit(48, "ms")).toBe("48 ms");
  });

  it("无单位去掉多余空格", () => {
    expect(formatNumberUnit(60, "")).toBe("60");
  });

  it("小数保留一位，整数不带小数", () => {
    expect(formatNumberUnit(5.25, "km")).toBe("5.3 km");
    expect(formatNumberUnit(5, "km")).toBe("5 km");
  });

  it("null 返回占位", () => {
    expect(formatNumberUnit(null, "bpm")).toBe("--");
  });
});

describe("formatAxisPace", () => {
  it("秒/公里渲染成 m:ss/km", () => {
    expect(formatAxisPace(360)).toBe("6:00/km");
    expect(formatAxisPace(366)).toBe("6:06/km");
  });

  it("四舍五入到 60 秒时进位到下一分钟", () => {
    expect(formatAxisPace(359.6)).toBe("6:00/km");
  });

  it("非有限值返回占位", () => {
    expect(formatAxisPace(Number.NaN)).toBe("--");
    expect(formatAxisPace("x")).toBe("--");
  });
});
