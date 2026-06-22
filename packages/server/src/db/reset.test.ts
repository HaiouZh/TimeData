import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAndPersistCommitHash, getCommitHash } from "../sync/state.js";
import { resetDatabaseConnectionToDefaults } from "./reset.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE categories (
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

    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE quick_notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT,
      last_done_at TEXT,
      start_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE track_steps (
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
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, note TEXT, prerequisites TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    CREATE TABLE sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      device TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      record_count INTEGER DEFAULT 0
    );

    CREATE TABLE sync_tombstones (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    );

    CREATE TABLE sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS health_heart_rate (id TEXT PRIMARY KEY, date TEXT NOT NULL, resting_heart_rate INTEGER, min_heart_rate INTEGER, max_heart_rate INTEGER, avg_heart_rate INTEGER, last_7_days_avg_resting_heart_rate INTEGER, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_hrv (id TEXT PRIMARY KEY, date TEXT NOT NULL, hrv_ms INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_sleep (id TEXT PRIMARY KEY, date TEXT NOT NULL, sleep_start TEXT NOT NULL, wake_time TEXT NOT NULL, adjustment_hours INTEGER NOT NULL DEFAULT 0, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_stress (id TEXT PRIMARY KEY, date TEXT NOT NULL, stress INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, distance_km REAL, duration_seconds INTEGER, average_heart_rate INTEGER, average_cadence REAL, average_stride_m REAL, average_vertical_ratio_percent REAL, average_vertical_oscillation_cm REAL, average_ground_contact_ms INTEGER, type TEXT NOT NULL, city TEXT NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_charts (id TEXT PRIMARY KEY, type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

  `);
});

afterEach(() => {
  db.close();
});

describe("resetDatabaseConnectionToDefaults", () => {
  it("deletes entries and restores the default categories", () => {
    const now = "2026-05-06T00:00:00.000Z";
    db.prepare(`
      INSERT INTO categories (id, name, color, created_at, updated_at)
      VALUES ('custom-cat', '自定义', '#000000', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO categories (id, name, parent_id, color, created_at, updated_at)
      VALUES ('custom-child', '子分类', 'custom-cat', '#000000', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at)
      VALUES ('entry-1', 'custom-child', ?, ?, ?, ?)
    `).run(now, "2026-05-06T01:00:00.000Z", now, now);
    db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES ('time_entries', 'entry-1', ?)
    `).run(now);
    db.prepare(`
      INSERT INTO quick_notes (id, text, occurred_at, created_at, updated_at)
      VALUES ('note-1', '临时想法', ?, ?, ?)
    `).run(now, now, now);
    db.prepare(`
      INSERT INTO tracks (id, title, status, refs, created_at, updated_at)
      VALUES ('track-1', '轨道', 'active', '[]', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO track_steps (id, track_id, source, content, started_at, refs, tags, seq, created_at, updated_at)
      VALUES ('step-1', 'track-1', 'agent', '', ?, '[]', '[]', 0, ?, ?)
    `).run(now, now, now);

    const result = resetDatabaseConnectionToDefaults(db);

    const entries = db.prepare("SELECT COUNT(*) as count FROM time_entries").get() as { count: number };
    const notes = db.prepare("SELECT COUNT(*) as count FROM quick_notes").get() as { count: number };
    const tracks = db.prepare("SELECT COUNT(*) as count FROM tracks").get() as { count: number };
    const steps = db.prepare("SELECT COUNT(*) as count FROM track_steps").get() as { count: number };
    const sleep = db.prepare("SELECT id, name FROM categories WHERE id = 'cat-sleep'").get() as {
      id: string;
      name: string;
    };
    const custom = db.prepare("SELECT id FROM categories WHERE id = 'custom-cat'").get();
    const seqCount = db.prepare("SELECT COUNT(*) as count FROM sync_seq").get() as { count: number };
    const tombstoneCount = db.prepare("SELECT COUNT(*) as count FROM sync_tombstones").get() as { count: number };

    expect(result.entriesDeleted).toBe(1);
    expect(result.categories).toBeGreaterThan(0);
    expect(entries.count).toBe(0);
    expect(notes.count).toBe(0);
    expect(steps.count).toBe(0);
    expect(tracks.count).toBe(0);
    expect(sleep).toEqual({ id: "cat-sleep", name: "睡眠" });
    expect(custom).toBeUndefined();
    expect(seqCount.count).toBe(0);
    expect(tombstoneCount.count).toBe(0);
  });

  it("refreshes sync_state after reset", () => {
    const now = "2026-05-06T00:00:00.000Z";
    db.prepare(`
      INSERT INTO categories (id, name, color, created_at, updated_at)
      VALUES ('custom-cat', '自定义', '#000000', ?, ?)
    `).run(now, now);
    computeAndPersistCommitHash(db);
    const before = getCommitHash(db).hash;

    resetDatabaseConnectionToDefaults(db);

    const after = getCommitHash(db);
    expect(after.hash).not.toBe(before);
    expect(after.latestSeq).toBeNull();
  });
});
