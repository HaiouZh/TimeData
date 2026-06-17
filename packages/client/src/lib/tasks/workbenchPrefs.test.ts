import { afterEach, describe, expect, it } from "vitest";
import {
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  clampSplitRatio,
  getDoneCollapsed,
  loadSplitRatio,
  saveSplitRatio,
  setDoneCollapsed,
} from "./workbenchPrefs.js";

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

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
  it("默认展开（未折叠）", () => {
    expect(getDoneCollapsed()).toBe(false);
  });

  it("可置为折叠", () => {
    setDoneCollapsed(true);
    expect(getDoneCollapsed()).toBe(true);
  });
});
