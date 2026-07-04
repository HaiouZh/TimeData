import { describe, expect, it } from "vitest";
import { formatJumpDateLabel } from "./jumpDateLabel.js";

describe("formatJumpDateLabel", () => {
  it("returns 今天 for today", () => {
    expect(formatJumpDateLabel("2026-07-04", "2026-07-04")).toBe("今天");
  });

  it("formats other dates as M月D日 without leading zeros", () => {
    expect(formatJumpDateLabel("2026-06-01", "2026-07-04")).toBe("6月1日");
    expect(formatJumpDateLabel("2026-12-31", "2026-07-04")).toBe("12月31日");
  });
});
