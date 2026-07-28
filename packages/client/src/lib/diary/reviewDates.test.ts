import { describe, expect, it } from "vitest";

import { isoWeekKey, isoWeekMonday, modeADates, modeBDates, modeCDates, sameDayInYear } from "./reviewDates.js";

describe("sameDayInYear", () => {
  it("普通日期直接换年", () => expect(sameDayInYear("2026-07-28", 2023)).toBe("2023-07-28"));
  it("2-29 平年顺延 2-28", () => expect(sameDayInYear("2024-02-29", 2023)).toBe("2023-02-28"));
  it("2-29 闰年保留", () => expect(sameDayInYear("2024-02-29", 2020)).toBe("2020-02-29"));
});
describe("isoWeekKey", () => {
  it("普通周", () => expect(isoWeekKey("2026-07-28")).toBe("2026-W31"));
  it("跨年周归上年", () => expect(isoWeekKey("2027-01-01")).toBe("2026-W53"));
  it("跨年周归下年", () => expect(isoWeekKey("2024-12-30")).toBe("2025-W01"));
});
describe("modeADates", () => {
  it("左昨天右今天各 N 年降序", () => {
    const { left, right } = modeADates("2026-07-28", 3);
    expect(right).toEqual(["2026-07-28", "2025-07-28", "2024-07-28"]);
    expect(left).toEqual(["2026-07-27", "2025-07-27", "2024-07-27"]);
  });
  it("3-01 的昨天按各年自己的月末", () => {
    // 锚 2026-03-01，昨天 2026-02-28；往年应是"那年的 02-28"同日，而不是那年 3 月前一天
    expect(modeADates("2026-03-01", 2).left).toEqual(["2026-02-28", "2025-02-28"]);
  });
});
describe("modeCDates", () => {
  it("周一锚定与 14 天展开", () => {
    const c = modeCDates("2026-07-28"); // 周二
    expect(c.thisWeek.key).toBe("2026-W31");
    expect(c.thisWeek.days[0]).toBe("2026-07-27");
    expect(c.thisWeek.days[6]).toBe("2026-08-02");
    expect(c.lastWeek.key).toBe("2026-W30");
    expect(c.lastWeek.days[0]).toBe("2026-07-20");
  });
});
describe("modeBDates", () => {
  it("前三天", () => expect(modeBDates("2026-07-28")).toEqual(["2026-07-27", "2026-07-26", "2026-07-25"]));
});

describe("isoWeekMonday", () => {
  it("周二回到本周一", () => expect(isoWeekMonday("2026-07-28")).toBe("2026-07-27"));
});
