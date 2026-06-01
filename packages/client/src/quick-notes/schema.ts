import { QuickNoteSchema, UtcIsoStringSchema, type QuickNote } from "@timedata/shared";

export const QUICK_NOTES_BACKUP_FORMAT = "timedata.quick-notes.backup";

export interface QuickNotesFile {
  format: typeof QUICK_NOTES_BACKUP_FORMAT;
  timeFormat: "utc";
  exportedAt: string;
  notes: QuickNote[];
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("速记备份必须是对象");
  }
  return value as Record<string, unknown>;
}

function parseQuickNotesFile(value: unknown): QuickNotesFile {
  const raw = objectValue(value);
  if (raw.format !== QUICK_NOTES_BACKUP_FORMAT) throw new Error("速记备份格式不正确");
  if (raw.timeFormat !== "utc") throw new Error("速记备份时间格式不正确");
  const exportedAt = UtcIsoStringSchema.parse(raw.exportedAt);
  if (!Array.isArray(raw.notes)) throw new Error("速记备份 notes 必须是数组");

  return {
    format: QUICK_NOTES_BACKUP_FORMAT,
    timeFormat: "utc",
    exportedAt,
    notes: raw.notes.map((note) => QuickNoteSchema.parse(note)),
  };
}

export const QuickNotesFileSchema = {
  parse: parseQuickNotesFile,
};
