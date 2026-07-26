import { afterEach, describe, expect, it } from "vitest";
import {
  clampSplitRatio,
  DIARY_SPLIT_PREFS,
  getDoneCollapsed,
  getInboxCollapsed,
  getScheduledCollapsed,
  loadSplitRatio,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  saveSplitRatio,
  setDoneCollapsed,
  setInboxCollapsed,
  setScheduledCollapsed,
  TODO_SPLIT_PREFS,
} from "./workbenchPrefs.js";

afterEach(() => localStorage.clear());

describe("clampSplitRatio", () => {
  it("夹到 [MIN, MAX]", () => {
    expect(clampSplitRatio(0.1)).toBe(SPLIT_MIN);
    expect(clampSplitRatio(0.9)).toBe(SPLIT_MAX);
    expect(clampSplitRatio(0.5)).toBe(0.5);
  });

  it("非有限值回默认", () => {
    expect(clampSplitRatio(Number.NaN)).toBe(SPLIT_DEFAULT);
  });
});

describe("split ratio 存取", () => {
  it("无值时返回默认", () => {
    expect(loadSplitRatio()).toBe(SPLIT_DEFAULT);
  });

  it("存入后读出（夹取）", () => {
    saveSplitRatio(0.5);
    expect(loadSplitRatio()).toBe(0.5);
    saveSplitRatio(0.95);
    expect(loadSplitRatio()).toBe(SPLIT_MAX);
  });

  it("坏值回默认", () => {
    localStorage.setItem("timedata_todo_workbench_split", "abc");
    expect(loadSplitRatio()).toBe(SPLIT_DEFAULT);
  });
});

describe("SplitPrefs 泛化", () => {
  it("日记 prefs 用自己的键，不串到待办页", () => {
    saveSplitRatio(0.8, DIARY_SPLIT_PREFS);
    expect(localStorage.getItem("timedata_diary_split")).toBe("0.8");
    expect(localStorage.getItem("timedata_todo_workbench_split")).toBeNull();
    expect(loadSplitRatio(DIARY_SPLIT_PREFS)).toBe(0.8);
    expect(loadSplitRatio(TODO_SPLIT_PREFS)).toBe(SPLIT_DEFAULT);
  });

  it("日记 prefs 用自己的范围夹取（0.5–0.85）", () => {
    expect(clampSplitRatio(0.4, DIARY_SPLIT_PREFS)).toBe(0.5);
    expect(clampSplitRatio(0.95, DIARY_SPLIT_PREFS)).toBe(0.85);
    expect(clampSplitRatio(0.75, DIARY_SPLIT_PREFS)).toBe(0.75);
  });

  it("待办范围里合法、日记范围里越界的值，两边夹出不同结果", () => {
    // 0.4 在待办范围 [0.35,0.7] 内合法，在日记范围 [0.5,0.85] 外要被夹到 0.5。
    // 这条是「范围真的分开了」的判据：若两边共用一组范围，本条必红。
    expect(clampSplitRatio(0.4, TODO_SPLIT_PREFS)).toBe(0.4);
    expect(clampSplitRatio(0.4, DIARY_SPLIT_PREFS)).toBe(0.5);
  });

  it("不传 prefs 时行为等同待办页（既有调用点零改动）", () => {
    expect(clampSplitRatio(0.9)).toBe(SPLIT_MAX);
    saveSplitRatio(0.5);
    expect(localStorage.getItem("timedata_todo_workbench_split")).toBe("0.5");
  });

  it("日记 prefs 坏值回自己的默认 0.7，不是待办的 0.62", () => {
    localStorage.setItem("timedata_diary_split", "abc");
    expect(loadSplitRatio(DIARY_SPLIT_PREFS)).toBe(0.7);
  });
});

describe("done collapsed 存取", () => {
  it("默认展开（已完成升级为顶级分区，作回看但不抢注意力时仍显展开）", () => {
    expect(getDoneCollapsed()).toBe(false);
  });

  it("可显式折叠后读出", () => {
    setDoneCollapsed(true);
    expect(getDoneCollapsed()).toBe(true);
  });

  it("可置为展开", () => {
    setDoneCollapsed(false);
    expect(getDoneCollapsed()).toBe(false);
  });
});

describe("inbox collapsed 存取", () => {
  it("默认展开（未折叠）", () => {
    expect(getInboxCollapsed()).toBe(false);
  });

  it("可置为折叠并读出", () => {
    setInboxCollapsed(true);
    expect(getInboxCollapsed()).toBe(true);
  });
});

describe("scheduled collapsed 存取", () => {
  it("未设偏好默认折叠（true）", () => {
    expect(getScheduledCollapsed()).toBe(true);
  });

  it("可往返存取", () => {
    setScheduledCollapsed(false);
    expect(getScheduledCollapsed()).toBe(false);
    setScheduledCollapsed(true);
    expect(getScheduledCollapsed()).toBe(true);
  });
});
