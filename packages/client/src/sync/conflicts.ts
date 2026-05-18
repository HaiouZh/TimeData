import type { Category, SyncLogEntry, TimeEntry } from "@timedata/shared";
import { db } from "../db/index.js";
import type { SyncConflict } from "./engine.js";

export type ConflictResolution = "keep_local" | "use_remote";

async function deleteCategoryTree(categoryId: string): Promise<{ categoryIds: string[]; entryIds: string[] }> {
  const categories = await db.categories.toArray();
  const target = categories.find((category) => category.id === categoryId);
  if (!target) return { categoryIds: [], entryIds: [] };

  const categoryIds = [target.id];
  for (let index = 0; index < categoryIds.length; index++) {
    const parentId = categoryIds[index];
    for (const category of categories) {
      if (category.parentId === parentId) {
        categoryIds.push(category.id);
      }
    }
  }
  const categoryIdSet = new Set(categoryIds);
  const entries = await db.timeEntries.filter((entry) => categoryIdSet.has(entry.categoryId)).toArray();
  const entryIds = entries.map((entry) => entry.id);

  await db.timeEntries.bulkDelete(entryIds);
  await db.categories.bulkDelete(categoryIds);
  return { categoryIds, entryIds };
}

async function deletePendingLogs(tableName: SyncLogEntry["tableName"], recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const recordIdSet = new Set(recordIds);
  const pending = await db.syncLog
    .filter((log) => log.tableName === tableName && recordIdSet.has(log.recordId) && !log.synced)
    .toArray();
  if (pending.length > 0) {
    await db.syncLog.bulkDelete(pending.map((log) => log.id));
  }
}

async function markPendingLogsSynced(conflict: SyncConflict): Promise<void> {
  const pending = await db.syncLog
    .where("recordId")
    .equals(conflict.recordId)
    .filter((log) => log.tableName === conflict.tableName && !log.synced)
    .toArray();
  if (pending.length > 0) {
    await db.syncLog.bulkUpdate(pending.map((log) => ({ key: log.id, changes: { synced: 1 } })));
  }
}

export async function resolveConflicts(conflicts: SyncConflict[], resolution: ConflictResolution): Promise<number> {
  if (resolution === "keep_local") return 0;

  return db.transaction("rw", db.categories, db.timeEntries, db.syncLog, async () => {
    let applied = 0;
    for (const conflict of conflicts) {
      if (conflict.remoteAction === "delete") {
        if (conflict.tableName === "categories") {
          const { categoryIds, entryIds } = await deleteCategoryTree(conflict.recordId);
          await deletePendingLogs("categories", categoryIds);
          await deletePendingLogs("time_entries", entryIds);
        } else {
          await db.timeEntries.delete(conflict.recordId);
          await deletePendingLogs("time_entries", [conflict.recordId]);
        }
        applied++;
        continue;
      }

      if (!conflict.remote) continue;
      if (conflict.tableName === "categories") {
        await db.categories.put(conflict.remote as Category);
      } else {
        await db.timeEntries.put(conflict.remote as TimeEntry);
      }
      applied++;
      await markPendingLogsSynced(conflict);
    }
    return applied;
  });
}
