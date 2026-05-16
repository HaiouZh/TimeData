import { db, resetSyncCursors } from "../db/index.js";
import { validateBackup } from "./validateBackup.js";
import type { BackupDocumentV2 } from "./schema.js";

export interface ImportBackupResult {
  categoryCount: number;
  entryCount: number;
}

export async function importBackup(value: unknown): Promise<ImportBackupResult> {
  const validation = validateBackup(value);
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }

  const backup: BackupDocumentV2 = validation.backup;

  await db.transaction("rw", db.categories, db.timeEntries, db.syncLog, async () => {
    const currentCategories = await db.categories.toArray();
    const currentNameById = new Map(currentCategories.map((category) => [category.id, category.name]));
    const categories = backup.categories.map((category) => {
      const currentName = currentNameById.get(category.id);
      return currentName ? { ...category, name: currentName } : category;
    });

    await db.timeEntries.clear();
    await db.syncLog.clear();
    await db.categories.clear();
    await db.categories.bulkAdd(categories);
    await db.timeEntries.bulkAdd(backup.timeEntries);
  });

  resetSyncCursors();

  return {
    categoryCount: backup.categories.length,
    entryCount: backup.timeEntries.length,
  };
}
