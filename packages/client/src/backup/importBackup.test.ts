import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Category, SyncLogEntry, TimeEntry } from "@timedata/shared";
import { db, LAST_SYNCED_KEY, LAST_SYNCED_SEQ_KEY } from "../db/index.js";
import { BACKUP_FORMAT, type BackupDocument } from "./schema.js";
import { importBackup } from "./importBackup.js";

const now = "2026-05-07T12:00:00.000Z";

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

const oldCategory: Category = {
  id: "old-cat",
  name: "旧分类",
  parentId: null,
  color: "#111111",
  icon: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: now,
  updatedAt: now,
};

const oldEntry: TimeEntry = {
  id: "old-entry",
  categoryId: "old-cat",
  startTime: "2026-05-07T08:00:00.000Z",
  endTime: "2026-05-07T09:00:00.000Z",
  note: "旧记录",
  createdAt: now,
  updatedAt: now,
};

const newCategory: Category = {
  id: "new-cat",
  name: "新分类",
  parentId: null,
  color: "#4A90D9",
  icon: null,
  sortOrder: 1,
  isArchived: false,
  createdAt: now,
  updatedAt: now,
};

const newEntry: TimeEntry = {
  id: "new-entry",
  categoryId: "new-cat",
  startTime: "2026-05-07T10:00:00.000Z",
  endTime: "2026-05-07T11:00:00.000Z",
  note: "恢复测试",
  createdAt: now,
  updatedAt: now,
};

const syncLog: SyncLogEntry = {
  id: "sync-1",
  tableName: "categories",
  recordId: "old-cat",
  action: "update",
  timestamp: now,
  synced: 1,
};

function backup(): BackupDocument {
  return {
    format: BACKUP_FORMAT,
    timeFormat: "utc",
    exportedAt: now,
    appVersion: "0.1.0-test",
    device: { deviceId: "device-1", deviceName: "Web" },
    categories: [newCategory],
    timeEntries: [newEntry],
  };
}

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.syncLog.clear();
  await db.categories.clear();
  localStorage.clear();
});

describe("importBackup", () => {
  it("replaces local categories and entries and clears sync state", async () => {
    await db.categories.add(oldCategory);
    await db.timeEntries.add(oldEntry);
    await db.syncLog.add(syncLog);
    localStorage.setItem(LAST_SYNCED_KEY, "2026-05-07T13:00:00.000Z");
    localStorage.setItem(LAST_SYNCED_SEQ_KEY, "42");

    const result = await importBackup(backup());

    await expect(db.categories.toArray()).resolves.toEqual([newCategory]);
    await expect(db.timeEntries.toArray()).resolves.toEqual([newEntry]);
    await expect(db.syncLog.toArray()).resolves.toEqual([]);
    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBeNull();
    expect(localStorage.getItem(LAST_SYNCED_SEQ_KEY)).toBeNull();
    expect(result).toEqual({ categoryCount: 1, entryCount: 1 });
  });

  it("does not modify local data when validation fails", async () => {
    await db.categories.add(oldCategory);
    await db.timeEntries.add(oldEntry);

    await expect(importBackup({ ...backup(), timeEntries: [{ ...newEntry, categoryId: "missing" }] })).rejects.toThrow("记录 new-entry 引用了不存在的分类 missing。");

    await expect(db.categories.toArray()).resolves.toEqual([oldCategory]);
    await expect(db.timeEntries.toArray()).resolves.toEqual([oldEntry]);
  });

  it("keeps current category names for matching ids when importing an older external backup", async () => {
    const currentCategory: Category = {
      ...oldCategory,
      name: "当前名称",
      updatedAt: "2026-05-08T12:00:00.000Z",
    };
    const externalBackupCategory: Category = {
      ...oldCategory,
      name: "旧备份名称",
      updatedAt: "2026-05-07T12:00:00.000Z",
    };
    const externalBackupEntry: TimeEntry = {
      ...oldEntry,
      note: "仍然关联同一个分类 ID",
    };

    await db.categories.add(currentCategory);

    const result = await importBackup({
      ...backup(),
      categories: [externalBackupCategory],
      timeEntries: [externalBackupEntry],
    });

    await expect(db.categories.toArray()).resolves.toEqual([
      {
        ...externalBackupCategory,
        name: "当前名称",
      },
    ]);
    await expect(db.timeEntries.toArray()).resolves.toEqual([externalBackupEntry]);
    expect(result).toEqual({ categoryCount: 1, entryCount: 1 });
  });
});
