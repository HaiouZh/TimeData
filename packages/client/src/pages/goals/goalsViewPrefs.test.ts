import { describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import { readGoalsViewMode, resolveGoalsViewMode, writeGoalsViewMode } from "./goalsViewPrefs.js";

describe("readGoalsViewMode", () => {
  it("无值返回 null（表示从未手选）", () => {
    expect(readGoalsViewMode()).toBeNull();
  });

  it("存入后读出", () => {
    writeGoalsViewMode("list");
    expect(readGoalsViewMode()).toBe("list");
    expect(localStorage.getItem(STORAGE_KEYS.goalsViewMode)).toBe("list");
  });

  it("坏值当没有偏好", () => {
    localStorage.setItem(STORAGE_KEYS.goalsViewMode, "constellation");
    expect(readGoalsViewMode()).toBeNull();
  });
});

describe("resolveGoalsViewMode", () => {
  it("无偏好时按宽窄给默认", () => {
    expect(resolveGoalsViewMode(true, null)).toBe("galaxy");
    expect(resolveGoalsViewMode(false, null)).toBe("list");
  });

  it("有偏好时偏好胜出，宽窄不再覆盖", () => {
    expect(resolveGoalsViewMode(true, "list")).toBe("list");
    expect(resolveGoalsViewMode(false, "galaxy")).toBe("galaxy");
  });
});
