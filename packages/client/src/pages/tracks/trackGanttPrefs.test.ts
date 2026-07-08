import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import {
  clampGanttWidth,
  GANTT_WIDTH_DEFAULT,
  GANTT_WIDTH_HARD_MAX,
  GANTT_WIDTH_MIN,
  ganttWidthMax,
  loadGanttWidth,
  saveGanttWidth,
} from "./trackGanttPrefs.js";

beforeEach(() => localStorage.clear());

describe("clampGanttWidth", () => {
  it("上限 = min(960, 视口70%)", () => {
    expect(ganttWidthMax(2000)).toBe(GANTT_WIDTH_HARD_MAX);
    expect(ganttWidthMax(1000)).toBe(700);
    expect(clampGanttWidth(5000, 1000)).toBe(700);
  });
  it("下限 360，非法值回默认", () => {
    expect(clampGanttWidth(10, 1440)).toBe(GANTT_WIDTH_MIN);
    expect(clampGanttWidth(Number.NaN, 1440)).toBe(GANTT_WIDTH_DEFAULT);
  });
  it("窄视口下上限不低于下限", () => {
    expect(ganttWidthMax(400)).toBe(GANTT_WIDTH_MIN);
  });
});

describe("load / save", () => {
  it("无存储回默认", () => {
    expect(loadGanttWidth(1440)).toBe(GANTT_WIDTH_DEFAULT);
  });
  it("save 后 load 还原，读取时按当前视口再夹", () => {
    saveGanttWidth(900, 2000);
    expect(localStorage.getItem(STORAGE_KEYS.trackGanttWidth)).toBe("900");
    expect(loadGanttWidth(2000)).toBe(900);
    expect(loadGanttWidth(1000)).toBe(700);
  });
  it("脏存储值回默认", () => {
    localStorage.setItem(STORAGE_KEYS.trackGanttWidth, "not-a-number");
    expect(loadGanttWidth(1440)).toBe(GANTT_WIDTH_DEFAULT);
  });
});
