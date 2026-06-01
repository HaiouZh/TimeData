import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { QuickNotesFileSchema, type QuickNotesFile } from "./schema.js";

export interface ImportQuickNotesResult {
  inserted: number;
  updated: number;
  kept: number;
}

export function validateQuickNotesFile(value: unknown): QuickNotesFile {
  return QuickNotesFileSchema.parse(value);
}

export async function importQuickNotes(value: unknown): Promise<ImportQuickNotesResult> {
  const backup = validateQuickNotesFile(value);
  let inserted = 0;
  let updated = 0;
  let kept = 0;

  await db.transaction("rw", db.quickNotes, db.syncLog, async () => {
    for (const incoming of backup.notes) {
      const existing = await db.quickNotes.get(incoming.id);
      if (!existing) {
        await db.quickNotes.add(incoming);
        await recordSyncLog("quick_notes", incoming.id, "create", incoming.updatedAt);
        inserted += 1;
      } else if (incoming.updatedAt > existing.updatedAt) {
        await db.quickNotes.put(incoming);
        await recordSyncLog("quick_notes", incoming.id, "update", incoming.updatedAt);
        updated += 1;
      } else {
        kept += 1;
      }
    }
  });

  return { inserted, updated, kept };
}
