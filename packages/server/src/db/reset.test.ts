import { createDefaultCategories, encodeGoalLayoutPinKey } from "@timedata/shared";
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

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      note TEXT,
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
      updated_at TEXT NOT NULL,
      edited_at TEXT
    );

    CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, note TEXT, members TEXT NOT NULL DEFAULT '[]', prerequisites TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS goal_layout_pins (
      goal_id TEXT NOT NULL,
      node_kind TEXT NOT NULL,
      node_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, node_kind, node_id)
    );

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
  it("deletes every sync domain, appends tombstones and seq, then records the default categories", () => {
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
    db.prepare(`
      INSERT INTO goal_layout_pins (goal_id, node_kind, node_id, x, y, updated_at)
      VALUES ('goal-1', 'goal', 'goal-1', 10, 20, ?)
    `).run(now);
    db.prepare(`
      INSERT INTO goals (id, title, kind, status, note, members, prerequisites, created_at, updated_at)
      VALUES ('goal-1', '目标', 'project', 'active', NULL, '[]', '[]', ?, ?)
    `).run(now, now);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('setting-1', 'value', ?)").run(now);
    db.prepare(`
      INSERT INTO tasks (id, title, done, recurrence, last_done_at, start_at, sort_order, created_at, updated_at)
      VALUES ('task-1', '任务', 0, NULL, NULL, NULL, 0, ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO sessions (id, started_at, created_at, updated_at)
      VALUES ('session-1', ?, ?, ?)
    `).run(now, now, now);
    db.prepare(`
      INSERT INTO health_charts (id, type, sort_order, config, created_at, updated_at)
      VALUES ('chart-1', 'line', 0, '{}', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO health_heart_rate
        (id, date, resting_heart_rate, created_at, updated_at)
      VALUES ('heart-1', '2026-05-06', 60, ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO health_hrv (id, date, hrv_ms, created_at, updated_at)
      VALUES ('hrv-1', '2026-05-06', 50, ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO health_sleep (id, date, sleep_start, wake_time, adjustment_hours, created_at, updated_at)
      VALUES ('sleep-1', '2026-05-06', ?, ?, 0, ?, ?)
    `).run(now, "2026-05-06T08:00:00.000Z", now, now);
    db.prepare(`
      INSERT INTO health_stress (id, date, stress, created_at, updated_at)
      VALUES ('stress-1', '2026-05-06', 20, ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO runs (id, date, start_time, type, city, created_at, updated_at)
      VALUES ('run-1', '2026-05-06', ?, 'run', 'Taipei', ?, ?)
    `).run(now, now, now);
    db.prepare(`
      INSERT INTO sync_seq (table_name, record_id, action, created_at)
      VALUES ('categories', 'historic-record', 'delete', ?)
    `).run(now);
    const highCursor = Number(
      (db.prepare("SELECT MAX(id) AS id FROM sync_seq").get() as { id: number }).id,
    );
    db.prepare(`
      INSERT INTO sync_tombstones (table_name, record_id, deleted_at)
      VALUES ('tracks', 'historic-track', ?)
    `).run(now);

    const result = resetDatabaseConnectionToDefaults(db);

    const sleep = db.prepare("SELECT id, name FROM categories WHERE id = 'cat-sleep'").get() as {
      id: string;
      name: string;
    };
    const custom = db.prepare("SELECT id FROM categories WHERE id = 'custom-cat'").get();
    const changesAfterCursor = db
      .prepare("SELECT table_name, record_id, action FROM sync_seq WHERE id > ? ORDER BY id")
      .all(highCursor) as Array<{ table_name: string; record_id: string; action: string }>;
    const deletedKeys = new Set(
      changesAfterCursor
        .filter((change) => change.action === "delete")
        .map((change) => `${change.table_name}:${change.record_id}`),
    );
    const finalCategoryChanges = changesAfterCursor.filter(
      (change) => change.table_name === "categories" && change.action !== "delete",
    );
    const firstResetChange = changesAfterCursor[0];
    const defaultCategoryIds = createDefaultCategories(result.resetAt).map((category) => category.id);

    expect(result.entriesDeleted).toBe(1);
    expect(result.categories).toBeGreaterThan(0);
    expect(firstResetChange).toMatchObject({
      table_name: "categories",
      action: "delete",
    });
    for (const table of [
      "time_entries",
      "settings",
      "quick_notes",
      "tasks",
      "sessions",
      "health_heart_rate",
      "health_hrv",
      "health_sleep",
      "health_stress",
      "runs",
      "health_charts",
      "track_steps",
      "tracks",
      "goals",
      "goal_layout_pins",
    ]) {
      expect(db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(sleep).toEqual({ id: "cat-sleep", name: "睡眠" });
    expect(custom).toBeUndefined();
    expect(
      db.prepare("SELECT action FROM sync_seq WHERE record_id = 'historic-record'").get(),
    ).toEqual({ action: "delete" });
    expect(
      db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = 'tracks' AND record_id = 'historic-track'").get(),
    ).toEqual({ deleted_at: now });
    expect([...deletedKeys]).toEqual(
      expect.arrayContaining([
        "categories:custom-cat",
        "categories:custom-child",
        "time_entries:entry-1",
        "settings:setting-1",
        "quick_notes:note-1",
        "tasks:task-1",
        "sessions:session-1",
        "health_heart_rate:heart-1",
        "health_hrv:hrv-1",
        "health_sleep:sleep-1",
        "health_stress:stress-1",
        "runs:run-1",
        "health_charts:chart-1",
        "track_steps:step-1",
        "tracks:track-1",
        "goals:goal-1",
        `goal_layout_pins:${encodeGoalLayoutPinKey("goal-1", "goal", "goal-1")}`,
      ]),
    );
    expect(finalCategoryChanges.map((change) => change.record_id).sort()).toEqual(defaultCategoryIds.sort());
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'categories' AND record_id = 'custom-cat'").get(),
    ).toEqual({ record_id: "custom-cat" });
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'categories' AND record_id = 'cat-sleep'").get(),
    ).toBeUndefined();
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
    expect(after.latestSeq).toBeGreaterThan(0);
  });
});
