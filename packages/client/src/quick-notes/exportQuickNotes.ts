import { utcToLocalDateTime, type QuickNote } from "@timedata/shared";
import { listQuickNotesByDate, listQuickNotesByRange } from "../lib/quickNotes.js";
import { formatLocalClock } from "../lib/quickNoteDisplay.js";
import { QuickNotesFileSchema, QUICK_NOTES_BACKUP_FORMAT, type QuickNotesFile } from "./schema.js";

export interface ExportQuickNotesOptions {
  now?: () => string;
}

const MARKDOWN_TIME_GAP_MS = 5 * 60 * 1000;

function localDate(value: string): string {
  return utcToLocalDateTime(value).slice(0, 10);
}

function localMinute(value: string): string {
  return utcToLocalDateTime(value).slice(0, 16);
}

export async function exportQuickNotesJsonByRange(
  fromDate: string,
  toDate: string,
  options: ExportQuickNotesOptions = {},
): Promise<QuickNotesFile> {
  const notes = await listQuickNotesByRange(fromDate, toDate);
  return QuickNotesFileSchema.parse({
    format: QUICK_NOTES_BACKUP_FORMAT,
    timeFormat: "utc",
    exportedAt: options.now ? options.now() : new Date().toISOString(),
    notes,
  });
}

export async function exportQuickNotesJsonByDate(
  date: string,
  options: ExportQuickNotesOptions = {},
): Promise<QuickNotesFile> {
  return exportQuickNotesJsonByRange(date, date, options);
}

export function quickNotesMarkdown(title: string, notes: QuickNote[]): string {
  const lines = [`# ${title}`, ""];
  if (notes.length === 0) {
    lines.push("无速记", "");
    return lines.join("\n");
  }

  const sorted = [...notes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  let previousNote: QuickNote | null = null;
  let previousDate: string | null = null;
  let previousMinute: string | null = null;

  for (const note of sorted) {
    const noteDate = localDate(note.occurredAt);
    const noteMinute = localMinute(note.occurredAt);
    const isNewDate = noteDate !== previousDate;
    if (isNewDate) {
      previousDate = noteDate;
      previousMinute = null;
    }

    const gapFromPrevious = previousNote ? Date.parse(note.occurredAt) - Date.parse(previousNote.occurredAt) : 0;
    if (!previousNote || isNewDate || (noteMinute !== previousMinute && gapFromPrevious > MARKDOWN_TIME_GAP_MS)) {
      lines.push(`## ${formatLocalClock(note.occurredAt)}`, "");
    }

    lines.push(note.text, "");
    previousNote = note;
    previousMinute = noteMinute;
  }

  return lines.join("\n");
}

export async function exportQuickNotesMarkdownByDate(date: string): Promise<string> {
  return quickNotesMarkdown(`速记 ${date}`, await listQuickNotesByDate(date));
}

export async function exportQuickNotesMarkdownByRange(fromDate: string, toDate: string): Promise<string> {
  const title = fromDate === toDate ? `速记 ${fromDate}` : `速记 ${fromDate} 至 ${toDate}`;
  return quickNotesMarkdown(title, await listQuickNotesByRange(fromDate, toDate));
}
