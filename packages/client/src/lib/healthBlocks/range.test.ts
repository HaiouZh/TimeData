import { describe, expect, it } from "vitest";
import { resolveBlockRange } from "./range.js";

describe("resolveBlockRange", () => {
  const pageRange = { mode: "recent" as const, days: 30 };

  it("inherits the page range", () => {
    expect(resolveBlockRange({ mode: "inherit" }, pageRange)).toEqual(pageRange);
  });

  it("uses block-specific ranges", () => {
    expect(resolveBlockRange({ mode: "recent", days: 7 }, pageRange)).toEqual({ mode: "recent", days: 7 });
    expect(resolveBlockRange({ mode: "manual", from: "2026-06-01", to: "2026-06-15" }, pageRange)).toEqual({
      mode: "manual",
      from: "2026-06-01",
      to: "2026-06-15",
    });
    expect(resolveBlockRange({ mode: "all" }, pageRange)).toEqual({ mode: "all" });
  });
});
