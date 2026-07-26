import { afterEach, describe, expect, it } from "vitest";
import { getDiaryRefCollapsed, setDiaryRefCollapsed } from "./diaryRefPrefs.js";

afterEach(() => localStorage.clear());

describe("参考栏折叠偏好", () => {
  it("三块「今天」默认都展开（未设偏好时 collapsed 为 false）", () => {
    expect(getDiaryRefCollapsed("punches")).toBe(false);
    expect(getDiaryRefCollapsed("doneTasks")).toBe(false);
    expect(getDiaryRefCollapsed("quickNotes")).toBe(false);
  });

  it("每块各用一把键，互不串味", () => {
    setDiaryRefCollapsed("punches", true);
    expect(getDiaryRefCollapsed("punches")).toBe(true);
    expect(getDiaryRefCollapsed("doneTasks")).toBe(false);
    expect(getDiaryRefCollapsed("quickNotes")).toBe(false);
  });

  it("可往返存取", () => {
    setDiaryRefCollapsed("doneTasks", true);
    expect(getDiaryRefCollapsed("doneTasks")).toBe(true);
    setDiaryRefCollapsed("doneTasks", false);
    expect(getDiaryRefCollapsed("doneTasks")).toBe(false);
  });
});
