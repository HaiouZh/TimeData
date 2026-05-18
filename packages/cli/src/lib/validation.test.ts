import { describe, expect, it } from "vitest";
import { validateDate, validateTimeRange } from "./validation.js";

describe("CLI validation", () => {
  it("accepts valid dates and rejects impossible dates", () => {
    expect(validateDate("2026-05-07")).toBeNull();
    expect(validateDate("2026-02-30")).toEqual({ code: "INVALID_DATE", message: "Invalid date: 2026-02-30" });
  });

  it("validates HH:mm ranges", () => {
    expect(validateTimeRange("14:00", "16:00")).toBeNull();
    expect(validateTimeRange("24:00", "16:00")).toEqual({
      code: "INVALID_TIME_RANGE",
      message: "Start and end must use HH:mm format",
    });
    expect(validateTimeRange("16:00", "14:00")).toEqual({
      code: "INVALID_TIME_RANGE",
      message: "End time must be later than start time",
    });
  });
});
