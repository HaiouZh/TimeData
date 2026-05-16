import { db, type AutoBackupRecord } from "../db/index.js";
import { v4 as uuid } from "uuid";

const MAX_AUTO_BACKUPS = 7;

export async function createAutoBackup(): Promise<void> {
  const [categories, timeEntries] = await Promise.all([
    db.categories.toArray(),
    db.timeEntries.toArray(),
  ]);

  if (categories.length === 0 && timeEntries.length === 0) return;

  const latest = await db.autoBackups.orderBy("createdAt").reverse().first();
  if (latest && sameBackupData(latest, { categories, timeEntries })) return;

  const record: AutoBackupRecord = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    categories,
    timeEntries,
  };

  await db.autoBackups.add(record);
  await pruneOldBackups();
}

export function backupSignature(data: Pick<AutoBackupRecord, "categories" | "timeEntries">): string {
  const latestUpdate = (items: { updatedAt: string }[]) =>
    items.reduce((max, item) => (item.updatedAt > max ? item.updatedAt : max), "");

  return `${data.categories.length}:${data.timeEntries.length}:${latestUpdate(data.categories)}|${latestUpdate(data.timeEntries)}`;
}

function sameBackupData(
  existing: Pick<AutoBackupRecord, "categories" | "timeEntries">,
  next: Pick<AutoBackupRecord, "categories" | "timeEntries">,
): boolean {
  return backupSignature(existing) === backupSignature(next);
}

async function pruneOldBackups(): Promise<void> {
  const all = await db.autoBackups.orderBy("createdAt").reverse().toArray();
  if (all.length <= MAX_AUTO_BACKUPS) return;

  const toDelete = all.slice(MAX_AUTO_BACKUPS);
  await db.autoBackups.bulkDelete(toDelete.map((b) => b.id));
}

export async function listAutoBackups(): Promise<AutoBackupRecord[]> {
  return db.autoBackups.orderBy("createdAt").reverse().toArray();
}
