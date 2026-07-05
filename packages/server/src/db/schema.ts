import type { Database } from "better-sqlite3";
import type { CountRow } from "../lib/db-rows.js";
import { backfillMissingSeq } from "./backfillSeq.js";
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

export function ensureTaskScheduledColumns(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("scheduled_at")) db.exec("ALTER TABLE tasks ADD COLUMN scheduled_at TEXT");
  // Index must be created after the column exists; legacy DBs only get the column here.
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_at ON tasks(scheduled_at)");
}

export function ensureTaskParentIdColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("parent_id")) db.exec("ALTER TABLE tasks ADD COLUMN parent_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id)");
}

export function ensureTaskCompletedCountColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("completed_count")) db.exec("ALTER TABLE tasks ADD COLUMN completed_count INTEGER NOT NULL DEFAULT 0");
}

export function ensureTaskWeightColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("weight")) db.exec("ALTER TABLE tasks ADD COLUMN weight INTEGER NOT NULL DEFAULT 0");
}

export function ensureTaskRuleIdColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("rule_id")) db.exec("ALTER TABLE tasks ADD COLUMN rule_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_rule_id ON tasks(rule_id)");
}

export function ensureTaskSkippedColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("skipped")) db.exec("ALTER TABLE tasks ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0");
}

export function ensureTaskCompletionMetadataColumns(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("completed_at")) db.exec("ALTER TABLE tasks ADD COLUMN completed_at TEXT");
  if (!names.has("tags")) db.exec("ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
}

export function ensureGoalMembersColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(goals)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("members")) db.exec("ALTER TABLE goals ADD COLUMN members TEXT NOT NULL DEFAULT '[]'");
}

export function ensureTrackStepEditedAtColumn(db: Database): void {
  const names = new Set((db.prepare("PRAGMA table_info(track_steps)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!names.has("edited_at")) db.exec("ALTER TABLE track_steps ADD COLUMN edited_at TEXT");
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

/**
 * 对称于 ensureXxxColumns 的幂等删列：列不存在则跳过（SQLite 无原生 DROP COLUMN IF EXISTS）。
 * SQLite 拒删带索引的列，故先按 indexNames DROP INDEX。不支持删 PK/UNIQUE 约束内的列。
 */
export function dropColumnsIfExist(
  db: Database,
  table: string,
  columns: string[],
  indexNames: string[] = [],
): void {
  for (const indexName of indexNames) db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`);
  const tableName = quoteIdentifier(table);
  const present = new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const column of columns) {
    if (!present.has(column)) continue;
    db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${quoteIdentifier(column)}`);
    present.delete(column);
  }
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

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT,
      last_done_at TEXT,
      start_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      parent_id TEXT,
      completed_count INTEGER NOT NULL DEFAULT 0,
      weight INTEGER NOT NULL DEFAULT 0,
      rule_id TEXT,
      skipped INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      members TEXT NOT NULL DEFAULT '[]',
      prerequisites TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goal_layout_pins (
      goal_id TEXT NOT NULL,
      node_kind TEXT NOT NULL,
      node_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, node_kind, node_id)
    );

    CREATE TABLE IF NOT EXISTS track_steps (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_label TEXT,
      content TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      refs TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      edited_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      device TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      record_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS api_request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      token_tier TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      client_hint TEXT,
      device_label TEXT,
      duration_ms INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tracks_updated_at ON tracks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
    CREATE INDEX IF NOT EXISTS idx_goals_updated_at ON goals(updated_at);
    CREATE INDEX IF NOT EXISTS idx_goal_layout_pins_goal_id ON goal_layout_pins(goal_id);
    CREATE INDEX IF NOT EXISTS idx_goal_layout_pins_updated_at ON goal_layout_pins(updated_at);
    CREATE INDEX IF NOT EXISTS idx_track_steps_track_id ON track_steps(track_id);
    CREATE INDEX IF NOT EXISTS idx_track_steps_track_seq ON track_steps(track_id, seq);
    CREATE INDEX IF NOT EXISTS idx_track_steps_updated_at ON track_steps(updated_at);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_timestamp ON sync_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_api_request_logs_timestamp ON api_request_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_api_request_logs_status ON api_request_logs(status);
    CREATE INDEX IF NOT EXISTS idx_api_request_logs_outcome ON api_request_logs(outcome);
    CREATE INDEX IF NOT EXISTS idx_api_request_logs_token_tier ON api_request_logs(token_tier);
    CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at ON sync_tombstones(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_sync_seq_table_record ON sync_seq(table_name, record_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS health_heart_rate (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      resting_heart_rate INTEGER,
      min_heart_rate INTEGER,
      max_heart_rate INTEGER,
      avg_heart_rate INTEGER,
      last_7_days_avg_resting_heart_rate INTEGER,
      sync_seq INTEGER,
      sync_tombstone INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hhr_date ON health_heart_rate(date) WHERE sync_tombstone = 0;

    CREATE TABLE IF NOT EXISTS health_hrv (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      hrv_ms INTEGER NOT NULL,
      sync_seq INTEGER,
      sync_tombstone INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hhrv_date ON health_hrv(date) WHERE sync_tombstone = 0;

    CREATE TABLE IF NOT EXISTS health_sleep (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      sleep_start TEXT NOT NULL,
      wake_time TEXT NOT NULL,
      adjustment_hours REAL NOT NULL DEFAULT 0,
      sync_seq INTEGER,
      sync_tombstone INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hs_date ON health_sleep(date) WHERE sync_tombstone = 0;

    CREATE TABLE IF NOT EXISTS health_stress (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      stress INTEGER NOT NULL,
      sync_seq INTEGER,
      sync_tombstone INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hst_date ON health_stress(date) WHERE sync_tombstone = 0;

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      distance_km REAL,
      duration_seconds INTEGER,
      average_heart_rate INTEGER,
      average_cadence REAL,
      average_stride_m REAL,
      average_vertical_ratio_percent REAL,
      average_vertical_oscillation_cm REAL,
      average_ground_contact_ms INTEGER,
      type TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      sync_seq INTEGER,
      sync_tombstone INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_date ON runs(date) WHERE sync_tombstone = 0;

    CREATE TABLE IF NOT EXISTS health_charts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_health_charts_sort ON health_charts(sort_order);

    CREATE TABLE IF NOT EXISTS server_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureQuickNoteSourceColumns(db);
  ensureQuickNotePinnedColumn(db);
  ensureTaskScheduledColumns(db);
  ensureTaskCompletedCountColumn(db);
  ensureTaskWeightColumn(db);
  ensureTaskCompletionMetadataColumns(db);
  ensureTaskParentIdColumn(db);
  ensureTaskRuleIdColumn(db);
  ensureTaskSkippedColumn(db);
  ensureGoalMembersColumn(db);
  ensureTrackStepEditedAtColumn(db);
  dropColumnsIfExist(db, "tasks", ["goal_id"], ["idx_tasks_goal_id"]);
  dropColumnsIfExist(db, "tracks", ["goal_id"], ["idx_tracks_goal_id"]);
  // 退役 turn（M2，2026-06-20）：摘掉 tasks 表的 turn/turn_at 列。明文列名是合法墓碑，
  // 复用 M1 的幂等删列 helper；旧列不存在时 no-op。见 docs_local/specs/2026-06-20-退役turn-design.md。
  dropColumnsIfExist(db, "tasks", ["turn", "turn_at"]);

  const count = db.prepare("SELECT COUNT(*) as count FROM categories").get() as CountRow;
  if (count.count === 0) {
    insertDefaultCategories(db);
  }

  // 账本模型迁移：给早于 seq 机制写入、以及默认播种的业务行补 seq，否则它们对 seq-only pull 不可见。
  // 幂等，启动时跑一次即可；已齐全时为 no-op。见 ADR 0012。
  backfillMissingSeq(db);
}
