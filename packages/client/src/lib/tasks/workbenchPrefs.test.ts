import { afterEach, describe, expect, it } from "vitest";
import {
  clampSplitRatio,
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
