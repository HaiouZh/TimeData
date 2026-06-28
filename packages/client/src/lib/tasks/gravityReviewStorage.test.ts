import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  markGravityTasksSurfaced,
  readGravitySurfacedMap,
  writeGravitySurfacedMap,
} from "./gravityReviewStorage.ts";

const localStorageMock = (() => {
  let store = new Map<string, string>();
  return {
    clear: () => { store = new Map<string, string>(); },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });

beforeEach(() => {
  localStorage.clear();
});

describe("gravityReviewStorage", () => {
  it("roundtrips surfaced map", () => {
    writeGravitySurfacedMap({ a: "2026-06-28T00:00:00.000Z" });
    expect(readGravitySurfacedMap()).toEqual({ a: "2026-06-28T00:00:00.000Z" });
  });

  it("falls back to empty map for corrupted JSON", () => {
    localStorage.setItem("timedata_todo_gravity_last_surfaced", "{bad json");
    expect(readGravitySurfacedMap()).toEqual({});
  });

  it("marks only supplied ids as surfaced", () => {
    markGravityTasksSurfaced(["a", "b"], new Date("2026-06-28T12:00:00.000Z"));
    expect(readGravitySurfacedMap()).toEqual({
      a: "2026-06-28T12:00:00.000Z",
      b: "2026-06-28T12:00:00.000Z",
    });
  });
});