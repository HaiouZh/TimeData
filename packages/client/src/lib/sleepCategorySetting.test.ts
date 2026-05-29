import { afterEach, describe, expect, it } from "vitest";
import { getSleepCategoryId, setSleepCategoryId } from "./sleepCategorySetting.js";
import { STORAGE_KEYS } from "./storageKeys.js";

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

afterEach(() => {
  globalThis.localStorage?.removeItem(STORAGE_KEYS.sleepCategoryId);
});

describe("sleepCategorySetting", () => {
  it("默认未指定返回 null", () => {
    expect(getSleepCategoryId()).toBeNull();
  });
  it("写入后可读回", () => {
    setSleepCategoryId("cat-sleep");
    expect(getSleepCategoryId()).toBe("cat-sleep");
  });
  it("传 null 清除设置", () => {
    setSleepCategoryId("cat-sleep");
    setSleepCategoryId(null);
    expect(getSleepCategoryId()).toBeNull();
  });
});
