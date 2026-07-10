import type { Category, SyncLogEntry, TimeEntry } from "@timedata/shared";
import { collectCategoryTreeIds } from "../lib/categoryTree.js";
import { db } from "../db/index.js";
import type { SyncConflict } from "./engine.js";

export type ConflictResolution = "keep_local" | "use_remote";

async function getCategoryTreeRecords(categoryId: string): Promise<{ categoryIds: string[]; entryIds: string[] }> {
  const categories = await db.categories.toArray();
  const categoryIds = collectCategoryTreeIds(categories, categoryId);
  if (categoryIds.length === 0) return { categoryIds: [], entryIds: [] };

  const categoryIdSet = new Set(categoryIds);
  const entries = await db.timeEntries.filter((entry) => categoryIdSet.has(entry.categoryId)).toArray();
  return { categoryIds, entryIds: entries.map((entry) => entry.id) };
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

function conflictSourceLogIds(conflict: SyncConflict): Set<string> | null {
  const ids = conflict.sourceLogIds ?? (conflict.localLog ? [conflict.localLog.id] : []);
  return ids.length > 0 ? new Set(ids) : null;
}

async function deleteConflictLogs(conflict: SyncConflict, tableName: SyncLogEntry["tableName"], recordIds: string[]): Promise<void> {
  const sourceIds = conflictSourceLogIds(conflict);
  if (!sourceIds) {
    await deletePendingLogs(tableName, recordIds);
    return;
  }
  await db.syncLog.bulkDelete([...sourceIds]);
}

async function hasNewerPendingLogs(
  conflict: SyncConflict,
  tableNames: SyncLogEntry["tableName"][],
  recordIds: string[],
): Promise<boolean> {
  const sourceIds = conflictSourceLogIds(conflict);
  if (!sourceIds) return false;
  const tableNameSet = new Set(tableNames);
  const recordIdSet = new Set(recordIds);
  const pending = await db.syncLog
    .filter((log) => tableNameSet.has(log.tableName) && recordIdSet.has(log.recordId) && !log.synced)
    .toArray();
  return pending.some((log) => !sourceIds.has(log.id));
}

async function markPendingLogsSynced(conflict: SyncConflict): Promise<void> {
  const sourceIds = conflictSourceLogIds(conflict);
  if (sourceIds) {
    await db.syncLog.bulkUpdate([...sourceIds].map((id) => ({ key: id, changes: { synced: 1 } })));
    return;
  }
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
          const { categoryIds, entryIds } = await getCategoryTreeRecords(conflict.recordId);
          const hasNewerPending = await hasNewerPendingLogs(
            conflict,
            ["categories", "time_entries"],
            [...categoryIds, ...entryIds],
          );
          if (hasNewerPending) {
            await deleteConflictLogs(conflict, "categories", categoryIds);
            continue;
          }
          await db.timeEntries.bulkDelete(entryIds);
          await db.categories.bulkDelete(categoryIds);
          await deleteConflictLogs(conflict, "categories", categoryIds);
          if (!conflictSourceLogIds(conflict)) await deletePendingLogs("time_entries", entryIds);
        } else {
          const hasNewerPending = await hasNewerPendingLogs(conflict, ["time_entries"], [conflict.recordId]);
          if (hasNewerPending) {
            await deleteConflictLogs(conflict, "time_entries", [conflict.recordId]);
            continue;
          }
          await db.timeEntries.delete(conflict.recordId);
          await deleteConflictLogs(conflict, "time_entries", [conflict.recordId]);
        }
        applied++;
        continue;
      }

      if (!conflict.remote) continue;
      const hasNewerPending = await hasNewerPendingLogs(conflict, [conflict.tableName], [conflict.recordId]);
      if (hasNewerPending) {
        await markPendingLogsSynced(conflict);
        continue;
      }
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
