import { QuickNoteSchema, localDateTimeToUtc, type QuickNote } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { addDays } from "./time.js";

export interface AddQuickNoteOptions {
  occurredAt?: string;
  now?: Date;
}

export interface UpdateQuickNotePatch {
  text?: string;
  occurredAt?: string;
  now?: Date;
}

function normalizeText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("速记内容不能为空");
  return trimmed;
}

function sortQuickNotes(notes: QuickNote[]): QuickNote[] {
  return [...notes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

function dateRangeBounds(fromDate: string, toDate: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error("日期格式必须是 YYYY-MM-DD");
  }
  if (toDate < fromDate) throw new Error("结束日期不能早于开始日期");

  return {
    start: localDateTimeToUtc(`${fromDate}T00:00:00`),
    end: localDateTimeToUtc(`${addDays(toDate, 1)}T00:00:00`),
  };
}

export async function addQuickNote(text: string, options: AddQuickNoteOptions = {}): Promise<QuickNote> {
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const note: QuickNote = QuickNoteSchema.parse({
    id: uuid(),
    text: normalizeText(text),
    occurredAt: options.occurredAt ?? createdAt,
    createdAt,
    updatedAt: createdAt,
  });

  await db.transaction("rw", db.quickNotes, db.syncLog, async () => {
    await db.quickNotes.add(note);
    await recordSyncLog("quick_notes", note.id, "create", note.updatedAt);
  });
  return note;
}

export async function updateQuickNote(id: string, patch: UpdateQuickNotePatch): Promise<QuickNote> {
  const existing = await db.quickNotes.get(id);
  if (!existing) throw new Error("速记不存在");

  const now = patch.now ?? new Date();
  const next: QuickNote = QuickNoteSchema.parse({
    ...existing,
    text: patch.text === undefined ? existing.text : normalizeText(patch.text),
    occurredAt: patch.occurredAt ?? existing.occurredAt,
    updatedAt: now.toISOString(),
  });

  await db.transaction("rw", db.quickNotes, db.syncLog, async () => {
    await db.quickNotes.put(next);
    await recordSyncLog("quick_notes", next.id, "update", next.updatedAt);
  });
  return next;
}

export async function deleteQuickNote(id: string): Promise<void> {
  await db.transaction("rw", db.quickNotes, db.syncLog, async () => {
    await db.quickNotes.delete(id);
    await recordSyncLog("quick_notes", id, "delete");
  });
}

export async function listQuickNotesByDate(date: string): Promise<QuickNote[]> {
  return listQuickNotesByRange(date, date);
}

export async function listQuickNotesByRange(fromDate: string, toDate: string): Promise<QuickNote[]> {
  const { start, end } = dateRangeBounds(fromDate, toDate);
  const notes = await db.quickNotes.where("occurredAt").between(start, end, true, false).toArray();
  return sortQuickNotes(notes);
}
