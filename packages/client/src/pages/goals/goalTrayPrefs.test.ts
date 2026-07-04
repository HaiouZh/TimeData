import { afterEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import {
  TRAY_WIDTH_DEFAULT,
  TRAY_WIDTH_MAX,
  TRAY_WIDTH_MIN,
  clampTrayWidth,
  loadTrayWidth,
  saveTrayWidth,
} from "./goalTrayPrefs.js";


afterEach(() => localStorage.clear());

describe("clampTrayWidth", () => {
  it("夹到 [MIN, MAX]", () => {
    expect(clampTrayWidth(100)).toBe(TRAY_WIDTH_MIN);
    expect(clampTrayWidth(9999)).toBe(TRAY_WIDTH_MAX);
    expect(clampTrayWidth(420)).toBe(420);
  });

  it("非有限值回默认", () => {
    expect(clampTrayWidth(Number.NaN)).toBe(TRAY_WIDTH_DEFAULT);
  });
});

describe("tray width 存取", () => {
  it("无值时返回默认", () => {
    expect(loadTrayWidth()).toBe(TRAY_WIDTH_DEFAULT);
  });

  it("存入后读出（夹取）", () => {
    saveTrayWidth(420);
    expect(loadTrayWidth()).toBe(420);
    expect(localStorage.getItem(STORAGE_KEYS.goalTrayWidth)).toBe("420");
    saveTrayWidth(9999);
    expect(loadTrayWidth()).toBe(TRAY_WIDTH_MAX);
  });

  it("坏值回默认", () => {
    localStorage.setItem(STORAGE_KEYS.goalTrayWidth, "abc");
    expect(loadTrayWidth()).toBe(TRAY_WIDTH_DEFAULT);
  });
});
