import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, LAST_SYNCED_KEY, LAST_SYNCED_SEQ_KEY, resetSyncCursors } from "./index.js";

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

describe("syncLog migrations", () => {
  it("upgrades boolean synced values to 0 or 1", async () => {
    // 使用独立 Dexie 实例仅升级到 v3，验证 boolean→number 的迁移行为。
    // 不使用应用的 db 实例，因为 v4 升级会清空 syncLog（UTC 迁移重置）。
    const dbName = "timedata-synclog-migration-test";

    const dbV2 = new Dexie(dbName);
    dbV2.version(1).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced",
    });
    dbV2.version(2).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced",
      autoBackups: "id, createdAt",
    });
    await dbV2.open();
    await dbV2.table("syncLog").bulkAdd([
      { id: "pending", tableName: "time_entries", recordId: "entry-1", action: "create", timestamp: "2026-05-08T09:00:00.000Z", synced: false },
      { id: "done", tableName: "categories", recordId: "cat-1", action: "update", timestamp: "2026-05-08T10:00:00.000Z", synced: true },
    ]);
    dbV2.close();

    const dbV3 = new Dexie(dbName);
    dbV3.version(1).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced",
    });
    dbV3.version(2).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced",
      autoBackups: "id, createdAt",
    });
    dbV3.version(3).stores({
      categories: "id, parentId, sortOrder",
      timeEntries: "id, categoryId, startTime, endTime",
      syncLog: "id, tableName, recordId, synced, [tableName+synced]",
      autoBackups: "id, createdAt",
    }).upgrade(async (tx) => {
      try {
        await tx.table("syncLog").toCollection().modify((log) => {
          log.synced = log.synced ? 1 : 0;
        });
      } catch {
        // keep Dexie upgrade best-effort
      }
    });
    await dbV3.open();

    await expect(dbV3.table("syncLog").orderBy("id").toArray()).resolves.toMatchObject([
      { id: "done", synced: 1 },
      { id: "pending", synced: 0 },
    ]);

    dbV3.close();
    await Dexie.delete(dbName);
  });
});
