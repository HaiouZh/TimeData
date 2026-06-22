import type { Category, QuickNote, Setting, SyncChange, Task, TimeEntry } from "@timedata/shared";

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
  table_name: SyncChange["tableName"];
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

export interface TaskRow {
  id: string;
  parent_id: string | null;
  goal_id: string | null;
  title: string;
  done: number;
  recurrence: string | null;
  last_done_at: string | null;
  start_at: string | null;
  sort_order: number;
  scheduled_at: string | null;
  completed_count: number;
  completed_at: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    goalId: row.goal_id ?? null,
    title: row.title,
    done: Boolean(row.done),
    recurrence: row.recurrence ? JSON.parse(row.recurrence) : null,
    lastDoneAt: row.last_done_at,
    startAt: row.start_at,
    scheduledAt: row.scheduled_at ?? null,
    completedCount: row.completed_count ?? 0,
    completedAt: row.completed_at ?? null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
