// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./safeStorage.js";

let restoreLocalStorage: (() => void) | null = null;

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    ...overrides,
  } as Storage;
}

function installStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}

describe("safeStorage", () => {
  beforeEach(() => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    restoreLocalStorage = () => {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else Reflect.deleteProperty(globalThis, "localStorage");
    };
    installStorage(createStorage());
  });

  afterEach(() => {
    restoreLocalStorage?.();
    restoreLocalStorage = null;
  });

  it("正常 set/get 等同原生", () => {
    safeSetItem("k", "v");
    expect(safeGetItem("k")).toBe("v");
  });

  it("get 不存在的 key 返回 null", () => {
    expect(safeGetItem("missing")).toBeNull();
  });

  it("set 抛错时不冒泡到调用方", () => {
    installStorage(
      createStorage({
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
      }),
    );
    expect(() => safeSetItem("k", "v")).not.toThrow();
  });

  it("get 抛错时返回 null", () => {
    installStorage(
      createStorage({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    );
    expect(safeGetItem("k")).toBeNull();
  });

  it("remove 抛错时不冒泡", () => {
    installStorage(
      createStorage({
        removeItem: () => {
          throw new Error("SecurityError");
        },
      }),
    );
    expect(() => safeRemoveItem("k")).not.toThrow();
  });

  it("set 返回 true 表示成功", () => {
    expect(safeSetItem("k", "v")).toBe(true);
  });

  it("set 返回 false 表示失败", () => {
    installStorage(
      createStorage({
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
      }),
    );
    expect(safeSetItem("k", "v")).toBe(false);
  });
});
