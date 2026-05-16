import { db } from "../db/index.js";
import type { Category, TimeEntry } from "@timedata/shared";
import type { SyncConflict } from "./engine.js";

export type ConflictResolution = "keep_local" | "use_remote";

export async function resolveConflicts(
  conflicts: SyncConflict[],
  resolution: ConflictResolution,
): Promise<number> {
  if (resolution === "keep_local") return 0;

  return db.transaction("rw", db.categories, db.timeEntries, db.syncLog, async () => {
    let applied = 0;
    for (const conflict of conflicts) {
      if (conflict.tableName === "categories") {
        await db.categories.put(conflict.remote as Category);
      } else {
        await db.timeEntries.put(conflict.remote as TimeEntry);
      }
      applied++;

      const pending = await db.syncLog
        .where("recordId").equals(conflict.recordId)
        .filter((log) => log.tableName === conflict.tableName && !log.synced)
        .toArray();
      if (pending.length > 0) {
        await db.syncLog.bulkUpdate(
          pending.map((log) => ({ key: log.id, changes: { synced: 1 } })),
        );
      }
    }
    return applied;
  });
}
