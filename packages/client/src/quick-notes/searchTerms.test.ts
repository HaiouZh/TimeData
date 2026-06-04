import { describe, expect, it } from "vitest";
import { matchesAllTerms, parseSearchTerms } from "./searchTerms.js";

describe("parseSearchTerms", () => {
  it("splits on whitespace, lowercases, removes blanks and deduplicates", () => {
    expect(parseSearchTerms("  Alpha\tbeta  ALPHA\nBeta  ")).toEqual(["alpha", "beta"]);
  });

  it("returns an empty array for blank queries", () => {
    expect(parseSearchTerms(" \n\t ")).toEqual([]);
  });
});

describe("matchesAllTerms", () => {
  it("matches one or more terms with AND semantics", () => {
    expect(matchesAllTerms("today meeting with zhang", ["meeting"])).toBe(true);
    expect(matchesAllTerms("today meeting with zhang", ["meeting", "zhang"])).toBe(true);
  });

  it("requires every term to be present", () => {
    expect(matchesAllTerms("today meeting with zhang", ["meeting", "milk"])).toBe(false);
  });
});
