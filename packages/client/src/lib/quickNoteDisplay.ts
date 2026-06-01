import type { QuickNote } from "@timedata/shared";
import { utcToLocalDateTime } from "@timedata/shared";

export type QuickNoteDisplayItem =
  | { type: "date"; key: string; label: string }
  | { type: "time"; key: string; label: string }
  | { type: "note"; key: string; note: QuickNote };

export interface GroupQuickNotesOptions {
  gapMinutes?: number;
}

function localMinute(value: string): string {
  return utcToLocalDateTime(value).slice(0, 16);
}

function localDate(value: string): string {
  return utcToLocalDateTime(value).slice(0, 10);
}

function localClock(value: string): string {
  return utcToLocalDateTime(value).slice(11, 16);
}

export function groupQuickNotesForDisplay(
  notes: QuickNote[],
  options: GroupQuickNotesOptions = {},
): QuickNoteDisplayItem[] {
  const gapMs = (options.gapMinutes ?? 5) * 60 * 1000;
  const sorted = [...notes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const items: QuickNoteDisplayItem[] = [];
  let previousNote: QuickNote | null = null;
  let previousDate: string | null = null;
  let previousMinute: string | null = null;

  for (const note of sorted) {
    const noteDate = localDate(note.occurredAt);
    const noteMinute = localMinute(note.occurredAt);
    const isNewDate = noteDate !== previousDate;

    if (isNewDate) {
      items.push({ type: "date", key: `date:${noteDate}`, label: noteDate });
      previousDate = noteDate;
      previousMinute = null;
    }

    const gapFromPrevious = previousNote ? Date.parse(note.occurredAt) - Date.parse(previousNote.occurredAt) : 0;
    if (!previousNote || isNewDate || (noteMinute !== previousMinute && gapFromPrevious > gapMs)) {
      items.push({ type: "time", key: `time:${note.id}`, label: localClock(note.occurredAt) });
    }

    items.push({ type: "note", key: `note:${note.id}`, note });
    previousNote = note;
    previousMinute = noteMinute;
  }

  return items;
}
