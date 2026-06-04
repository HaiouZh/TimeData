import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

export interface DeleteQuickNotesByIdsResult {
  deleted: number;
}

export async function deleteQuickNotesByIds(ids: string[]): Promise<DeleteQuickNotesByIdsResult> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return { deleted: 0 };

  const deletedAt = new Date().toISOString();
  let deleted = 0;

  await db.transaction("rw", db.quickNotes, db.syncLog, async () => {
    const existingNotes = await db.quickNotes.bulkGet(uniqueIds);
    const existingIds = uniqueIds.filter((_, index) => existingNotes[index] !== undefined);
    deleted = existingIds.length;
    if (existingIds.length === 0) return;

    await db.quickNotes.bulkDelete(existingIds);
    for (const id of existingIds) {
      await recordSyncLog("quick_notes", id, "delete", deletedAt);
    }
  });

  return { deleted };
}
