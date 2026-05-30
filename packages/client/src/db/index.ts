import Dexie, { type EntityTable } from "dexie";
import type { Category, Setting, TimeEntry, SyncLogEntry } from "@timedata/shared";
import { createDefaultCategories } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { safeGetItem, safeRemoveItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

export const LAST_SYNCED_KEY = STORAGE_KEYS.lastSynced;
export const LAST_SYNCED_SEQ_KEY = STORAGE_KEYS.lastSyncedSeq;

export function resetSyncCursors(): void {
  safeRemoveItem(STORAGE_KEYS.lastSynced);
  safeRemoveItem(STORAGE_KEYS.lastSyncedSeq);
}

export interface AutoBackupRecord {
  id: string;
  createdAt: string;
  categories: Category[];
  timeEntries: TimeEntry[];
}

export const db = new Dexie("timedata") as Dexie & {
  categories: EntityTable<Category, "id">;
  timeEntries: EntityTable<TimeEntry, "id">;
  syncLog: EntityTable<SyncLogEntry, "id">;
  autoBackups: EntityTable<AutoBackupRecord, "id">;
  settings: EntityTable<Setting, "key">;
};

db.version(1).stores({
  categories: "id, parentId, sortOrder",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
});

db.version(2).stores({
  categories: "id, parentId, sortOrder",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
});

export async function seedDefaultCategories(): Promise<void> {
  const count = await db.categories.count();
  if (count > 0) return;

  await db.categories.bulkAdd(createDefaultCategories());
}

export async function migrateLocalSettingsToDexie(): Promise<void> {
  const legacySleepCategoryId = safeGetItem(STORAGE_KEYS.sleepCategoryId);
  if (!legacySleepCategoryId) return;

  const existing = await db.settings.get("sleep.categoryId");
  if (existing) return;

  const now = new Date().toISOString();
  await db.transaction("rw", db.settings, db.syncLog, async () => {
    await db.settings.put({ key: "sleep.categoryId", value: legacySleepCategoryId, updatedAt: now });
    await db.syncLog.add({
      id: uuid(),
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "create",
      timestamp: now,
      synced: 0,
    });
  });
}

export async function resetLocalDataToDefaults(): Promise<void> {
  await db.transaction("rw", db.categories, db.timeEntries, db.syncLog, db.settings, async () => {
    await db.timeEntries.clear();
    await db.syncLog.clear();
    await db.settings.clear();
    await db.categories.clear();
    await db.categories.bulkAdd(createDefaultCategories());
  });

  resetSyncCursors();
}
