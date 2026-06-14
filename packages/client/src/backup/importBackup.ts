import { db, resetSyncCursors } from "../db/index.js";
import { BACKUP_BUNDLED_DOMAINS } from "../sync/clientDomains.js";
import type { BackupDocument } from "./schema.js";
import { validateBackup } from "./validateBackup.js";

export interface ImportBackupResult {
  categoryCount: number;
  entryCount: number;
  /** 各普通域恢复的记录数，按 table 名键入。 */
  domainCounts: Record<string, number>;
}

export async function importBackup(value: unknown): Promise<ImportBackupResult> {
  const validation = validateBackup(value);
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }

  const backup: BackupDocument = validation.backup;
  const bundledStores = BACKUP_BUNDLED_DOMAINS.map((domain) => db.table(domain.storeName));
  const domainCounts: Record<string, number> = {};

  await db.transaction("rw", [db.categories, db.timeEntries, db.syncLog, ...bundledStores], async () => {
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

    // 只覆盖备份里“存在”的域；缺省的域原样保留本地数据（见 validateBackup 注释）。
    for (const domain of BACKUP_BUNDLED_DOMAINS) {
      const records = backup.domains[domain.table];
      if (records === undefined) continue;
      const store = db.table(domain.storeName);
      await store.clear();
      await store.bulkAdd(records);
      domainCounts[domain.table] = records.length;
    }
  });

  resetSyncCursors();

  return {
    categoryCount: backup.categories.length,
    entryCount: backup.timeEntries.length,
    domainCounts,
  };
}
