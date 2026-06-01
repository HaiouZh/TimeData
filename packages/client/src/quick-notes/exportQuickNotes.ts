import type { QuickNote } from "@timedata/shared";
import { listQuickNotesByDate, listQuickNotesByRange } from "../lib/quickNotes.js";
import { groupQuickNotesForDisplay } from "../lib/quickNoteDisplay.js";
import { QuickNotesFileSchema, QUICK_NOTES_BACKUP_FORMAT, type QuickNotesFile } from "./schema.js";

export interface ExportQuickNotesOptions {
  now?: () => string;
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

  for (const item of groupQuickNotesForDisplay(notes)) {
    if (item.type === "date") continue;
    if (item.type === "time") {
      lines.push(`## ${item.label}`, "");
      continue;
    }
    lines.push(item.note.text, "");
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
