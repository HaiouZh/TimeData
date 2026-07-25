import { describe, expect, it } from "vitest";
import { buildSearchRange, formatSearchRangeLabel, shiftSearchAnchor } from "./range.js";

describe("buildSearchRange", () => {
  it("all 档两侧都无约束", () => {
    expect(buildSearchRange("all", "2026-02-14")).toEqual({ startUtc: null, endUtc: null });
  });

  it("year 档覆盖整年，右开", () => {
    const range = buildSearchRange("year", "2026-02-14");
    expect(range.startUtc).toBe("2025-12-31T16:00:00.000Z"); // 2026-01-01T00:00 +08:00
    expect(range.endUtc).toBe("2026-12-31T16:00:00.000Z"); // 2027-01-01T00:00 +08:00
  });

  it("month 档覆盖整月，右开", () => {
    const range = buildSearchRange("month", "2026-02-14");
    expect(range.startUtc).toBe("2026-01-31T16:00:00.000Z"); // 2026-02-01T00:00
    expect(range.endUtc).toBe("2026-02-28T16:00:00.000Z"); // 2026-03-01T00:00
  });

  it("week 档以周一为首、覆盖 7 天", () => {
    // 2026-02-14 是周六，所在周周一是 2026-02-09
    const range = buildSearchRange("week", "2026-02-14");
    expect(range.startUtc).toBe("2026-02-08T16:00:00.000Z"); // 2026-02-09T00:00
    expect(range.endUtc).toBe("2026-02-15T16:00:00.000Z"); // 2026-02-16T00:00
  });

  it("week 档锚点落在周日也归入同一周", () => {
    // 2026-02-15 是周日，仍属 02-09 那一周
    expect(buildSearchRange("week", "2026-02-15")).toEqual(buildSearchRange("week", "2026-02-14"));
  });
});

describe("shiftSearchAnchor", () => {
  it("all 档翻页是空操作", () => {
    expect(shiftSearchAnchor("all", "2026-02-14", -1)).toBe("2026-02-14");
    expect(shiftSearchAnchor("all", "2026-02-14", 1)).toBe("2026-02-14");
  });

  it("year 档进退整年", () => {
    expect(shiftSearchAnchor("year", "2026-02-14", -1)).toBe("2025-02-14");
    expect(shiftSearchAnchor("year", "2026-02-14", 1)).toBe("2027-02-14");
  });

  it("year 档跨闰日钳制到月末", () => {
    expect(shiftSearchAnchor("year", "2028-02-29", 1)).toBe("2029-02-28");
  });

  it("month 档进退整月并钳制月末", () => {
    expect(shiftSearchAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftSearchAnchor("month", "2026-03-15", -1)).toBe("2026-02-15");
  });

  it("week 档进退 7 天", () => {
    expect(shiftSearchAnchor("week", "2026-02-14", -1)).toBe("2026-02-07");
    expect(shiftSearchAnchor("week", "2026-02-14", 1)).toBe("2026-02-21");
  });
});

describe("formatSearchRangeLabel", () => {
  const today = "2026-02-14";

  it("all 档显示全部", () => {
    expect(formatSearchRangeLabel("all", "2026-02-14", today)).toBe("全部");
  });

  it("year 档显示年份", () => {
    expect(formatSearchRangeLabel("year", "2026-02-14", today)).toBe("2026");
  });

  it("month 档显示年月", () => {
    expect(formatSearchRangeLabel("month", "2026-02-14", today)).toBe("2026年02月");
  });

  it("week 档命中本周时显示本周", () => {
    expect(formatSearchRangeLabel("week", "2026-02-12", today)).toBe("本周");
  });

  it("week 档非本周显示起止日期", () => {
    expect(formatSearchRangeLabel("week", "2026-02-03", today)).toBe("2026-02-02 ~ 2026-02-08");
  });
});
