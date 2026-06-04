import { describe, expect, it } from "vitest";
import { splitHighlight } from "./highlightMatches.js";

describe("splitHighlight", () => {
  it("marks a single term and preserves original casing", () => {
    expect(splitHighlight("Alpha beta", ["alpha"])).toEqual([
      { text: "Alpha", match: true },
      { text: " beta", match: false },
    ]);
  });

  it("marks multiple terms", () => {
    expect(splitHighlight("今天开会买牛奶", ["开会", "牛奶"])).toEqual([
      { text: "今天", match: false },
      { text: "开会", match: true },
      { text: "买", match: false },
      { text: "牛奶", match: true },
    ]);
  });

  it("merges overlapping and adjacent matches", () => {
    expect(splitHighlight("abcde", ["bcd", "cd", "de"])).toEqual([
      { text: "a", match: false },
      { text: "bcde", match: true },
    ]);
  });

  it("returns a plain segment when nothing matches", () => {
    expect(splitHighlight("abc", ["xyz"])).toEqual([{ text: "abc", match: false }]);
  });
});
