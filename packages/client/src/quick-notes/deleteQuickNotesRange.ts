import { db } from "../db/index.js";
import { listQuickNotesByRange } from "../lib/quickNotes.js";
import { recordSyncLog } from "../sync/engine.js";

export interface DeleteQuickNotesRangeResult {
  deleted: number;
}

export async function deleteQuickNotesByRange(
  fromDate: string,
  toDate: string,
): Promise<DeleteQuickNotesRangeResult> {
  const notes = (await listQuickNotesByRange(fromDate, toDate)).filter((note) => note.pinned !== true);
  const ids = notes.map((note) => note.id);
  const deletedAt = new Date().toISOString();

  await db.transaction("rw", db.quickNotes, db.syncLog, async () => {
    await db.quickNotes.bulkDelete(ids);
    for (const id of ids) {
      await recordSyncLog("quick_notes", id, "delete", deletedAt);
    }
  });

  return { deleted: ids.length };
}
