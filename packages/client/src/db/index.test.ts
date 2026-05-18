import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, LAST_SYNCED_KEY, LAST_SYNCED_SEQ_KEY, resetSyncCursors, seedDefaultCategories } from "./index.js";

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

beforeEach(async () => {
  localStorage.clear();
  await db.delete();
});

afterEach(async () => {
  await db.delete();
});

describe("resetSyncCursors", () => {
  it("clears both timestamp and sequence sync cursors", () => {
    localStorage.setItem(LAST_SYNCED_KEY, "2026-05-07T13:00:00.000Z");
    localStorage.setItem(LAST_SYNCED_SEQ_KEY, "42");

    resetSyncCursors();

    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBeNull();
    expect(localStorage.getItem(LAST_SYNCED_SEQ_KEY)).toBeNull();
  });
});

describe("Dexie single-version database", () => {
  it("creates v1 schema and seeds default categories on a fresh open", async () => {
    await db.delete();

    await db.open();
    await seedDefaultCategories();

    expect(await db.categories.count()).toBeGreaterThan(0);
    expect(db.verno).toBe(1);
  });
});
