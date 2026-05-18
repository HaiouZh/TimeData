// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { safeGetItem, safeSetItem, safeRemoveItem } from "./safeStorage.js";

describe("safeStorage", () => {
  beforeEach(() => localStorage.clear());

  it("正常 set/get 等同原生", () => {
    safeSetItem("k", "v");
    expect(safeGetItem("k")).toBe("v");
  });

  it("get 不存在的 key 返回 null", () => {
    expect(safeGetItem("missing")).toBeNull();
  });

  it("set 抛错时不冒泡到调用方", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => safeSetItem("k", "v")).not.toThrow();
    spy.mockRestore();
  });

  it("get 抛错时返回 null", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(safeGetItem("k")).toBeNull();
    spy.mockRestore();
  });

  it("remove 抛错时不冒泡", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => safeRemoveItem("k")).not.toThrow();
    spy.mockRestore();
  });

  it("set 返回 true 表示成功", () => {
    expect(safeSetItem("k", "v")).toBe(true);
  });

  it("set 返回 false 表示失败", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(safeSetItem("k", "v")).toBe(false);
    spy.mockRestore();
  });
});
