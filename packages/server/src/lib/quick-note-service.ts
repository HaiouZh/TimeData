import { localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import type Database from "better-sqlite3";
import type { QuickNoteRow } from "./db-rows.js";
import { rowToQuickNote } from "./db-rows.js";

export interface CliQuickNoteItem {
  id: string;
  occurredAt: string;
  occurredLocal: string;
  text: string;
}

export interface CliQuickNotesResponse {
  ok: true;
  mode: "date" | "range" | "recent";
  date?: string;
  from?: string;
  to?: string;
  quickNotes: CliQuickNoteItem[];
  summary: {
    count: number;
  };
  serverTime: string;
}

type QuickNotesErrorCode = "INVALID_DATE" | "INVALID_REQUEST";

interface QuickNotesErrorResponse {
  ok: false;
  error: {
    code: QuickNotesErrorCode;
    message: string;
  };
}

export type QuickNotesQuery =
  | { mode: "date"; date: string }
  | { mode: "range"; from: string; to: string }
  | { mode: "recent"; limit: number };

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function error(code: QuickNotesErrorCode, message: string): QuickNotesErrorResponse {
  return { ok: false, error: { code, message } };
}

function toCliItem(row: QuickNoteRow): CliQuickNoteItem {
  const note = rowToQuickNote(row);
  return {
    id: note.id,
    occurredAt: note.occurredAt,
    occurredLocal: utcToLocalDateTime(note.occurredAt),
    text: note.text,
  };
}

function listByUtcRange(db: Database.Database, startUtc: string, endUtc: string): CliQuickNoteItem[] {
  const rows = db
    .prepare("SELECT * FROM quick_notes WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at ASC, id ASC")
    .all(startUtc, endUtc) as QuickNoteRow[];
  return rows.map(toCliItem);
}

export function listQuickNotesForCli(db: Database.Database, query: QuickNotesQuery): CliQuickNotesResponse | QuickNotesErrorResponse {
  let quickNotes: CliQuickNoteItem[];
  if (query.mode === "recent") {
    const rows = db
      .prepare("SELECT * FROM quick_notes ORDER BY occurred_at DESC, id DESC LIMIT ?")
      .all(query.limit) as QuickNoteRow[];
    quickNotes = rows.map(toCliItem);
  } else if (query.mode === "date") {
    if (!isValidDate(query.date)) return error("INVALID_DATE", `Invalid date: ${query.date}`);
    const startUtc = localDateTimeToUtc(`${query.date}T00:00:00`);
    const endUtc = localDateTimeToUtc(`${nextDate(query.date)}T00:00:00`);
    quickNotes = listByUtcRange(db, startUtc, endUtc);
  } else {
    if (!isValidDate(query.from)) return error("INVALID_DATE", `Invalid date: ${query.from}`);
    if (!isValidDate(query.to)) return error("INVALID_DATE", `Invalid date: ${query.to}`);
    if (query.to < query.from) return error("INVALID_REQUEST", "--to must be the same as or later than --from");
    const startUtc = localDateTimeToUtc(`${query.from}T00:00:00`);
    const endUtc = localDateTimeToUtc(`${nextDate(query.to)}T00:00:00`);
    quickNotes = listByUtcRange(db, startUtc, endUtc);
  }

  return {
    ok: true,
    mode: query.mode,
    ...(query.mode === "date" ? { date: query.date } : {}),
    ...(query.mode === "range" ? { from: query.from, to: query.to } : {}),
    quickNotes,
    summary: { count: quickNotes.length },
    serverTime: new Date().toISOString(),
  };
}
