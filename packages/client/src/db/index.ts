import Dexie, { type EntityTable } from "dexie";
import type { Category, TimeEntry, SyncLogEntry } from "@timedata/shared";
import { createDefaultCategories } from "@timedata/shared";

export const LAST_SYNCED_KEY = "timedata_last_synced";
export const LAST_SYNCED_SEQ_KEY = "timedata_last_synced_seq";

export function resetSyncCursors(): void {
  localStorage.removeItem(LAST_SYNCED_KEY);
  localStorage.removeItem(LAST_SYNCED_SEQ_KEY);
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
};

db.version(1).stores({
  categories: "id, parentId, sortOrder",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced",
});

db.version(2).stores({
  categories: "id, parentId, sortOrder",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced",
  autoBackups: "id, createdAt",
});

db.version(3).stores({
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
    // keep Dexie upgrade best-effort; sync code still treats boolean false as unsynced
  }
});

db.version(4).stores({
  categories: "id, parentId, sortOrder",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
}).upgrade(async (tx) => {
  await tx.table("timeEntries").clear();
  await tx.table("syncLog").clear();
  await tx.table("autoBackups").clear();
  await tx.table("categories").clear();
  await tx.table("categories").bulkAdd(createDefaultCategories());
  localStorage.removeItem(LAST_SYNCED_KEY);
  localStorage.removeItem(LAST_SYNCED_SEQ_KEY);
});

export async function seedDefaultCategories(): Promise<void> {
  const count = await db.categories.count();
  if (count > 0) return;

  await db.categories.bulkAdd(createDefaultCategories());
}

export async function resetLocalDataToDefaults(): Promise<void> {
  await db.transaction("rw", db.categories, db.timeEntries, db.syncLog, async () => {
    await db.timeEntries.clear();
    await db.syncLog.clear();
    await db.categories.clear();
    await db.categories.bulkAdd(createDefaultCategories());
  });

  resetSyncCursors();
}
