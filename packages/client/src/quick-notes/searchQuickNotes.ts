import type { QuickNote } from "@timedata/shared";
import { db } from "../db/index.js";
import { matchesAllTerms, parseSearchTerms } from "./searchTerms.js";

function sortQuickNoteResults(notes: QuickNote[]): QuickNote[] {
  return [...notes].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
}

export async function searchQuickNotes(query: string): Promise<QuickNote[]> {
  const terms = parseSearchTerms(query);
  if (terms.length === 0) return [];

  const notes = await db.quickNotes
    .filter((note) => matchesAllTerms(note.text.toLowerCase(), terms))
    .toArray();

  return sortQuickNoteResults(notes);
}
