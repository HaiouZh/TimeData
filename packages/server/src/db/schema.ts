import type { Database } from "better-sqlite3";
import type { CountRow } from "../lib/db-rows.js";
import { getDb } from "./connection.js";
import { insertDefaultCategories } from "./reset.js";

export function ensureQuickNoteSourceColumns(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("source")) db.exec("ALTER TABLE quick_notes ADD COLUMN source TEXT");
  if (!names.has("source_label")) db.exec("ALTER TABLE quick_notes ADD COLUMN source_label TEXT");
}

export function ensureQuickNotePinnedColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("pinned")) db.exec("ALTER TABLE quick_notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
}

export function initializeDatabase(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT NOT NULL DEFAULT '#808080',
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quick_notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT,
      source_label TEXT,
      pinned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      device TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      record_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    );

    CREATE TABLE IF NOT EXISTS sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entries_start ON time_entries(start_time);
    CREATE INDEX IF NOT EXISTS idx_entries_end ON time_entries(end_time);
    CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_quick_notes_occurred_at ON quick_notes(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_quick_notes_updated_at ON quick_notes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_timestamp ON sync_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at ON sync_tombstones(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_sync_seq_table_record ON sync_seq(table_name, record_id);
  `);

  ensureQuickNoteSourceColumns(db);
  ensureQuickNotePinnedColumn(db);

  const count = db.prepare("SELECT COUNT(*) as count FROM categories").get() as CountRow;
  if (count.count === 0) {
    insertDefaultCategories(db);
  }
}
