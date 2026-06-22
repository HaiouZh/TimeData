import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillMissingSeq } from "./backfillSeq.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, color TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE time_entries (id TEXT PRIMARY KEY, category_id TEXT, start_time TEXT, end_time TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE quick_notes (id TEXT PRIMARY KEY, text TEXT, occurred_at TEXT, created_at TEXT, updated_at TEXT, pinned INTEGER DEFAULT 0);
    CREATE TABLE sync_seq (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_heart_rate (id TEXT PRIMARY KEY, date TEXT NOT NULL, resting_heart_rate INTEGER, min_heart_rate INTEGER, max_heart_rate INTEGER, avg_heart_rate INTEGER, last_7_days_avg_resting_heart_rate INTEGER, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_hrv (id TEXT PRIMARY KEY, date TEXT NOT NULL, hrv_ms INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_sleep (id TEXT PRIMARY KEY, date TEXT NOT NULL, sleep_start TEXT NOT NULL, wake_time TEXT NOT NULL, adjustment_hours INTEGER NOT NULL DEFAULT 0, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_stress (id TEXT PRIMARY KEY, date TEXT NOT NULL, stress INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, distance_km REAL, duration_seconds INTEGER, average_heart_rate INTEGER, average_cadence REAL, average_stride_m REAL, average_vertical_ratio_percent REAL, average_vertical_oscillation_cm REAL, average_ground_contact_ms INTEGER, type TEXT NOT NULL, city TEXT NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_charts (id TEXT PRIMARY KEY, type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, recurrence TEXT, last_done_at TEXT, start_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, scheduled_at TEXT, parent_id TEXT, goal_id TEXT, completed_count INTEGER NOT NULL DEFAULT 0, turn TEXT, turn_at TEXT, completed_at TEXT, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, status TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', goal_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS track_steps (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, source TEXT NOT NULL, source_label TEXT, content TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, refs TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]', seq INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, note TEXT, prerequisites TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

  `);
});

afterEach(() => db.close());

function seqCount(table: string, recordId: string): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM sync_seq WHERE table_name = ? AND record_id = ?").get(table, recordId) as { c: number }).c;
}

describe("backfillMissingSeq", () => {
  it("records a create seq for business rows missing one (incl. seedless default categories)", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES ('cat-default', '默认', '#808080', 't', 't')").run();
    db.prepare("INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at) VALUES ('e1', 'cat-default', 't', 't', 't', 't')").run();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('sleep.categoryId', 'cat-default', 't')").run();
    db.prepare("INSERT INTO quick_notes (id, text, occurred_at, created_at, updated_at) VALUES ('n1', 'hi', 't', 't', 't')").run();
    db.prepare("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('task-1', '任务', 't', 't')").run();
    db.prepare("INSERT INTO health_charts (id, type, config, created_at, updated_at) VALUES ('chart-1', 'chart', '{}', 't', 't')").run();
    db.prepare("INSERT INTO tracks (id, title, status, refs, created_at, updated_at) VALUES ('track-1', '轨道', 'active', '[]', 't', 't')").run();
    db.prepare("INSERT INTO track_steps (id, track_id, source, content, started_at, refs, tags, seq, created_at, updated_at) VALUES ('step-1', 'track-1', 'agent', '', 't', '[]', '[]', 0, 't', 't')").run();
    db.prepare("INSERT INTO goals (id, title, kind, status, prerequisites, created_at, updated_at) VALUES ('goal-1', '目标', 'project', 'active', '[]', 't', 't')").run();

    const inserted = backfillMissingSeq(db);

    expect(inserted).toBe(9);
    expect(seqCount("categories", "cat-default")).toBe(1);
    expect(seqCount("time_entries", "e1")).toBe(1);
    expect(seqCount("settings", "sleep.categoryId")).toBe(1);
    expect(seqCount("quick_notes", "n1")).toBe(1);
    expect(seqCount("tasks", "task-1")).toBe(1);
    expect(seqCount("health_charts", "chart-1")).toBe(1);
    expect(seqCount("tracks", "track-1")).toBe(1);
    expect(seqCount("track_steps", "step-1")).toBe(1);
    expect(seqCount("goals", "goal-1")).toBe(1);
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'dirty'").get()).toMatchObject({ value: "1" });
  });

  it("leaves rows that already have a seq untouched and is idempotent", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES ('cat-has-seq', 'A', '#808080', 't', 't')").run();
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES ('categories', 'cat-has-seq', 'update')").run();
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES ('cat-no-seq', 'B', '#808080', 't', 't')").run();

    const first = backfillMissingSeq(db);
    const second = backfillMissingSeq(db);

    expect(first).toBe(1);
    expect(second).toBe(0);
    // 已有 seq 的行不被复制，仍只有原来那条 update。
    expect(seqCount("categories", "cat-has-seq")).toBe(1);
    expect(db.prepare("SELECT action FROM sync_seq WHERE table_name = 'categories' AND record_id = 'cat-has-seq'").get()).toMatchObject({ action: "update" });
    expect(seqCount("categories", "cat-no-seq")).toBe(1);
  });

  it("does nothing and skips dirty mark when every row already has a seq", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES ('c', 'A', '#808080', 't', 't')").run();
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES ('categories', 'c', 'create')").run();

    const inserted = backfillMissingSeq(db);

    expect(inserted).toBe(0);
    expect(db.prepare("SELECT value FROM sync_state WHERE key = 'dirty'").get()).toBeUndefined();
  });
});
