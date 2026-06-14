import { v4 as uuid } from "uuid";
import { type AutoBackupRecord, db } from "../db/index.js";

const MAX_AUTO_BACKUPS = 7;

export type AutoBackupRecordInput = Omit<AutoBackupRecord, "tasks"> & Partial<Pick<AutoBackupRecord, "tasks">>;

export function normalizeAutoBackupRecord(record: AutoBackupRecordInput): AutoBackupRecord {
  return {
    ...record,
    tasks: record.tasks ?? [],
  };
}

export async function createAutoBackup(): Promise<void> {
  const [categories, timeEntries, tasks] = await Promise.all([
    db.categories.toArray(),
    db.timeEntries.toArray(),
    db.tasks.toArray(),
  ]);

  if (categories.length === 0 && timeEntries.length === 0 && tasks.length === 0) return;

  const latest = await db.autoBackups.orderBy("createdAt").reverse().first();
  if (latest && sameBackupData(latest, { categories, timeEntries, tasks })) return;

  const record: AutoBackupRecord = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    categories,
    timeEntries,
    tasks,
  };

  await db.autoBackups.add(record);
  await pruneOldBackups();
}

export function backupSignature(
  data: Pick<AutoBackupRecord, "categories" | "timeEntries"> & Partial<Pick<AutoBackupRecord, "tasks">>,
): string {
  const byId = <T extends { id: string }>(left: T, right: T) => left.id.localeCompare(right.id);

  return JSON.stringify({
    categories: [...data.categories].sort(byId),
    timeEntries: [...data.timeEntries].sort(byId),
    tasks: [...(data.tasks ?? [])].sort(byId),
  });
}

function sameBackupData(
  existing: Pick<AutoBackupRecord, "categories" | "timeEntries"> & Partial<Pick<AutoBackupRecord, "tasks">>,
  next: Pick<AutoBackupRecord, "categories" | "timeEntries"> & Partial<Pick<AutoBackupRecord, "tasks">>,
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
  const records = await db.autoBackups.orderBy("createdAt").reverse().toArray();
  return records.map(normalizeAutoBackupRecord);
}
