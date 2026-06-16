import { describe, expect, it } from "vitest";
import { buildMonthGrid } from "./calendar.js";

describe("buildMonthGrid", () => {
  it("returns June 2026 without leading blanks because the month starts on Monday", () => {
    expect(buildMonthGrid(2026, 6)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  });

  it("pads March 2026 with six leading blanks because the month starts on Sunday", () => {
    const grid = buildMonthGrid(2026, 3);

    expect(grid.slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
    expect(grid.at(-1)).toBe(31);
  });

  it("uses 29 days for leap-year February and 28 days for common February", () => {
    expect(buildMonthGrid(2024, 2).at(-1)).toBe(29);
    expect(buildMonthGrid(2023, 2).at(-1)).toBe(28);
    expect(buildMonthGrid(2023, 2)).not.toContain(29);
  });
});
