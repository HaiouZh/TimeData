import { describe, expect, it } from "vitest";
import { formatClockHours, formatNumberUnit } from "./format.js";

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
