import { db, resetSyncCursors } from "../db/index.js";
import type { BackupDocument } from "./schema.js";
import { validateBackup } from "./validateBackup.js";

export interface ImportBackupResult {
  categoryCount: number;
  entryCount: number;
  taskCount: number;
}

export async function importBackup(value: unknown): Promise<ImportBackupResult> {
  const validation = validateBackup(value);
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }

  const backup: BackupDocument = validation.backup;

  await db.transaction("rw", db.categories, db.timeEntries, db.tasks, db.syncLog, async () => {
    const currentCategories = await db.categories.toArray();
    const currentNameById = new Map(currentCategories.map((category) => [category.id, category.name]));
    const categories = backup.categories.map((category) => {
      const currentName = currentNameById.get(category.id);
      return currentName ? { ...category, name: currentName } : category;
    });

    await db.timeEntries.clear();
    await db.tasks.clear();
    await db.syncLog.clear();
    await db.categories.clear();
    await db.categories.bulkAdd(categories);
    await db.timeEntries.bulkAdd(backup.timeEntries);
    await db.tasks.bulkAdd(backup.tasks);
  });

  resetSyncCursors();

  return {
    categoryCount: backup.categories.length,
    entryCount: backup.timeEntries.length,
    taskCount: backup.tasks.length,
  };
}
