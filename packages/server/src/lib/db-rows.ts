import type { Category, Setting, TimeEntry } from "@timedata/shared";

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
  table_name: "categories" | "time_entries" | "settings";
  record_id: string;
  deleted_at: string;
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

export function rowToSetting(row: SettingRow): Setting {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  };
}
