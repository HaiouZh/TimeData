import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import {
  clampGanttWidth,
  clampNameWidth,
  GANTT_WIDTH_DEFAULT,
  GANTT_WIDTH_MIN,
  ganttWidthMax,
  LIST_MIN_WIDTH,
  loadGanttWidth,
  loadNameWidth,
  NAME_WIDTH_DEFAULT,
  NAME_WIDTH_MAX,
  NAME_WIDTH_MIN,
  saveGanttWidth,
  saveNameWidth,
} from "./trackGanttPrefs.js";

beforeEach(() => localStorage.clear());

describe("clampGanttWidth", () => {
  it("上限 = 视口宽 − 左栏底线（无绝对像素硬顶）", () => {
    expect(ganttWidthMax(2000)).toBe(2000 - LIST_MIN_WIDTH);
    expect(ganttWidthMax(1000)).toBe(1000 - LIST_MIN_WIDTH);
    expect(clampGanttWidth(5000, 1000)).toBe(1000 - LIST_MIN_WIDTH);
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
    expect(loadGanttWidth(1000)).toBe(1000 - LIST_MIN_WIDTH);
  });
  it("脏存储值回默认", () => {
    localStorage.setItem(STORAGE_KEYS.trackGanttWidth, "not-a-number");
    expect(loadGanttWidth(1440)).toBe(GANTT_WIDTH_DEFAULT);
  });
});

describe("轨道名列宽", () => {
  it("clamp 在 [96, 360]，非法回默认", () => {
    expect(clampNameWidth(10)).toBe(NAME_WIDTH_MIN);
    expect(clampNameWidth(9999)).toBe(NAME_WIDTH_MAX);
    expect(clampNameWidth(Number.NaN)).toBe(NAME_WIDTH_DEFAULT);
  });
  it("save 后 load 还原，无存储回默认", () => {
    expect(loadNameWidth()).toBe(NAME_WIDTH_DEFAULT);
    saveNameWidth(240);
    expect(localStorage.getItem(STORAGE_KEYS.trackGanttNameWidth)).toBe("240");
    expect(loadNameWidth()).toBe(240);
  });
});
