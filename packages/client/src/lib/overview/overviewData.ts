import { QuickNoteSchema, type QuickNote } from "@timedata/shared";
import { db } from "../../db/index.js";

/** 读出全部合法速记，坏行直接丢掉。 */
export async function listAllQuickNotesForOverview(): Promise<QuickNote[]> {
  const rows = await db.quickNotes.toArray();
  return rows.flatMap((row) => {
    const parsed = QuickNoteSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}
