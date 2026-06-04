import type { Category, QuickNote, Setting, TimeEntry } from "@timedata/shared";

export interface CountRow {
  count: number;
}

export interface MaxRow {
  value: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string;
  icon: string | null;
  sort_order: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export interface EntryRow {
  id: string;
  category_id: string;
  start_time: string;
  end_time: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TombstoneRow {
  table_name: "categories" | "time_entries" | "settings" | "quick_notes";
  record_id: string;
  deleted_at: string;
}

export interface QuickNoteRow {
  id: string;
  text: string;
  occurred_at: string;
  created_at: string;
  updated_at: string;
  source: string | null;
  source_label: string | null;
  pinned?: number | null;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    categoryId: row.category_id,
    startTime: row.start_time,
    endTime: row.end_time,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToQuickNote(row: QuickNoteRow): QuickNote {
  return {
    id: row.id,
    text: row.text,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.source ? { source: row.source as "user" | "agent" } : {}),
    ...(row.source_label ? { sourceLabel: row.source_label } : {}),
    ...(row.pinned ? { pinned: true } : {}),
  };
}

export function rowToSetting(row: SettingRow): Setting {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  };
}
