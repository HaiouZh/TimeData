import { v4 as uuid } from "uuid";
import type Database from "better-sqlite3";
import { localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";

export interface CategoryPathItem {
  id: string;
  path: string;
  name: string;
  parentId: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  is_archived: number;
}

interface EntryRow {
  id: string;
  category_id: string;
  start_time: string;
  end_time: string;
  note: string | null;
}

export interface CliEntryInput {
  date: string;
  start: string;
  end: string;
  category: string;
  note?: string | null;
}

interface EntryServiceOptions {
  now?: Date;
}

type ErrorCode =
  | "INVALID_DATE"
  | "INVALID_TIME_RANGE"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_AMBIGUOUS"
  | "TIME_OVERLAP";

export interface ApiErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string>;
  };
}

export interface CategoryResolveSuccess {
  ok: true;
  categoryId: string;
}

export type CategoryResolveResult = CategoryResolveSuccess | { ok: false; code: "CATEGORY_NOT_FOUND" | "CATEGORY_AMBIGUOUS" };

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function durationMinutes(startTime: string, endTime: string): number {
  return Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
}

function error(code: ErrorCode, message: string, details?: Record<string, string>): ApiErrorBody {
  return details ? { ok: false, error: { code, message, details } } : { ok: false, error: { code, message } };
}

export function listCategoryPaths(db: Database.Database): CategoryPathItem[] {
  const rows = db.prepare("SELECT id, name, parent_id, is_archived FROM categories WHERE is_archived = 0 ORDER BY sort_order, name").all() as CategoryRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));

  return rows.map((row) => {
    const parent = row.parent_id ? byId.get(row.parent_id) : null;
    return {
      id: row.id,
      path: parent ? `${parent.name}/${row.name}` : row.name,
      name: row.name,
      parentId: row.parent_id,
    };
  });
}

export function resolveCategoryPath(db: Database.Database, path: string): CategoryResolveResult {
  const matches = listCategoryPaths(db).filter((category) => category.path === path);
  if (matches.length === 0) return { ok: false, code: "CATEGORY_NOT_FOUND" };
  if (matches.length > 1) return { ok: false, code: "CATEGORY_AMBIGUOUS" };
  return { ok: true, categoryId: matches[0].id };
}

function categoryPathMap(db: Database.Database): Map<string, string> {
  return new Map(listCategoryPaths(db).map((category) => [category.id, category.path]));
}

export function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function listEntriesForCliDate(db: Database.Database, date: string) {
  if (!isValidDate(date)) return error("INVALID_DATE", `Invalid date: ${date}`);

  const dayStartUtc    = localDateTimeToUtc(`${date}T00:00:00`);
  const nextDayStartUtc = localDateTimeToUtc(`${nextDate(date)}T00:00:00`);
  const rows = db.prepare(`
    SELECT * FROM time_entries
    WHERE start_time < ? AND end_time > ?
    ORDER BY start_time
  `).all(nextDayStartUtc, dayStartUtc) as EntryRow[];
  const paths = categoryPathMap(db);

  const entries = rows.map((row) => ({
    id: row.id,
    startTime: utcToLocalDateTime(row.start_time),
    endTime:   utcToLocalDateTime(row.end_time),
    durationMinutes: durationMinutes(row.start_time, row.end_time),
    category: paths.get(row.category_id) || "未知",
    note: row.note,
  }));

  return {
    ok: true,
    date,
    entries,
    summary: {
      totalMinutes: entries.reduce((total, entry) => total + entry.durationMinutes, 0),
      entryCount: entries.length,
    },
  };
}

export function createEntryFromCliInput(db: Database.Database, input: CliEntryInput, options: EntryServiceOptions = {}) {
  if (!isValidDate(input.date)) return error("INVALID_DATE", `Invalid date: ${input.date}`);
  if (!isValidTime(input.start) || !isValidTime(input.end)) {
    return error("INVALID_TIME_RANGE", "Start and end must use HH:mm format");
  }
  if (minutesOfDay(input.end) <= minutesOfDay(input.start)) {
    return error("INVALID_TIME_RANGE", "End time must be later than start time");
  }

  const category = resolveCategoryPath(db, input.category);
  if (!category.ok) {
    return error(category.code, category.code === "CATEGORY_AMBIGUOUS" ? `Category path is ambiguous: ${input.category}` : `Category not found: ${input.category}`);
  }

  const startTime = localDateTimeToUtc(`${input.date}T${input.start}:00`);
  const endTime   = localDateTimeToUtc(`${input.date}T${input.end}:00`);
  const nowUtc = (options.now ?? new Date()).toISOString();
  if (endTime > nowUtc) {
    return error("INVALID_TIME_RANGE", "End time cannot be in the future");
  }

  const createInTransaction = db.transaction(() => {
    const overlap = db.prepare(`
      SELECT id, start_time, end_time FROM time_entries
      WHERE start_time < ? AND ? < end_time
      ORDER BY start_time
      LIMIT 1
    `).get(endTime, startTime) as { id: string; start_time: string; end_time: string } | undefined;

    if (overlap) {
      return error("TIME_OVERLAP", "New entry overlaps with existing entry", {
        existingEntryId: overlap.id,
        existingStartTime: overlap.start_time,
        existingEndTime: overlap.end_time,
      });
    }

    const id = uuid();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, category.categoryId, startTime, endTime, input.note || null, now, now);

    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run("time_entries", id, "create");

    return {
      ok: true,
      entry: {
        id,
        date: input.date,
        startTime: utcToLocalDateTime(startTime),
        endTime:   utcToLocalDateTime(endTime),
        category: input.category,
        note: input.note || "",
      },
    };
  });

  return createInTransaction();
}
