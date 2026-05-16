import { beforeEach, describe, expect, it } from "vitest";
import { getMergeOvernightEnabled, setMergeOvernightEnabled } from "./overnightDisplaySetting.js";

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
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

beforeEach(() => {
  localStorage.clear();
});

describe("overnight display setting", () => {
  it("defaults to enabled", () => {
    expect(getMergeOvernightEnabled()).toBe(true);
  });

  it("uses the explicit saved setting", () => {
    setMergeOvernightEnabled(false);

    expect(getMergeOvernightEnabled()).toBe(false);

    setMergeOvernightEnabled(true);

    expect(getMergeOvernightEnabled()).toBe(true);
  });
});
