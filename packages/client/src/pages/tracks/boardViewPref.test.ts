// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import { loadBoardView, saveBoardView } from "./boardViewPref.js";

afterEach(() => localStorage.clear());

describe("boardViewPref", () => {
  it("defaults to flat", () => {
    expect(loadBoardView()).toBe("flat");
  });

  it("round-trips grouped view", () => {
    saveBoardView("grouped");
    expect(loadBoardView()).toBe("grouped");
    expect(localStorage.getItem(STORAGE_KEYS.tracksBoardView)).toBe("grouped");
  });

  it("falls back to flat on unknown stored value", () => {
    localStorage.setItem(STORAGE_KEYS.tracksBoardView, "garbage");
    expect(loadBoardView()).toBe("flat");
  });
});
