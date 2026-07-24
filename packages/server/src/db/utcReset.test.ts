import { createDefaultCategories } from "@timedata/shared";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { computeAndPersistCommitHash, getCommitHash } from "../sync/state.js";
import { runUtcResetIfNeeded } from "./utcReset.js";

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
      color TEXT NOT NULL DEFAULT '#808080', icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      device TEXT, action TEXT NOT NULL, detail TEXT, record_count INTEGER DEFAULT 0
    );
    CREATE TABLE sync_tombstones (
      table_name TEXT NOT NULL, record_id TEXT NOT NULL, deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    );
    CREATE TABLE sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL,
      record_id TEXT NOT NULL, action TEXT NOT NULL,
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
  return db;
}

describe("runUtcResetIfNeeded", () => {
  it("clears business data and seeds defaults on first run", () => {
    const db = makeTestDb();
    // 插入旧数据
    db.prepare(
      "INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("e1", "c1", "2026-05-13T15:00:00", "2026-05-13T16:00:00", new Date().toISOString(), new Date().toISOString());
    db.prepare("INSERT INTO sync_logs (action) VALUES (?)").run("push");
    db.prepare("INSERT INTO sync_tombstones (table_name, record_id, deleted_at) VALUES (?, ?, ?)").run(
      "time_entries",
      "e1",
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO quick_notes (id, text, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "note-1",
      "旧速记",
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO tracks (id, title, status, refs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "track-1",
      "旧轨道",
      "active",
      "[]",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO track_steps (id, track_id, source, content, started_at, refs, tags, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "step-1",
      "track-1",
      "agent",
      "",
      new Date().toISOString(),
      "[]",
      "[]",
      0,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO goal_layout_pins (goal_id, node_kind, node_id, x, y, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("goal-1", "goal", "goal-1", 10, 20, new Date().toISOString());
    computeAndPersistCommitHash(db);

    const result = runUtcResetIfNeeded(db);

    expect(result.ran).toBe(true);
    expect(result.resetAt).toBeTruthy();
    expect((db.prepare("SELECT COUNT(*) as n FROM time_entries").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM quick_notes").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM track_steps").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM tracks").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM goal_layout_pins").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM sync_logs").get() as { n: number }).n).toBe(0);
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'time_entries' AND record_id = 'e1'").get(),
    ).toEqual({ record_id: "e1" });
    // 默认分类已重建
    expect((db.prepare("SELECT COUNT(*) as n FROM categories").get() as { n: number }).n).toBeGreaterThan(0);
    const categorySeq = db
      .prepare("SELECT record_id, action FROM sync_seq WHERE table_name = 'categories' AND action != 'delete' ORDER BY id")
      .all() as Array<{ record_id: string; action: string }>;
    expect(categorySeq.map((row) => row.record_id).sort()).toEqual(
      createDefaultCategories(result.resetAt).map((category) => category.id).sort(),
    );
    expect(
      db.prepare("SELECT action FROM sync_seq WHERE table_name = 'time_entries' AND record_id = 'e1' ORDER BY id DESC").get(),
    ).toEqual({ action: "delete" });
    // 标记已写入
    const flag = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get("utc_reset_v1") as
      | { value: string }
      | undefined;
    expect(flag?.value).toBeTruthy();
    expect(getCommitHash(db).latestSeq).toBeGreaterThan(0);
  });

  it("does NOT run reset on subsequent calls (idempotent)", () => {
    const db = makeTestDb();
    runUtcResetIfNeeded(db);
    // 插入新数据（模拟重置后正常写入的 UTC 记录）
    db.prepare(
      "INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "e2",
      "cat1",
      "2026-05-14T07:00:00.000Z",
      "2026-05-14T08:00:00.000Z",
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const result = runUtcResetIfNeeded(db);

    expect(result.ran).toBe(false);
    // 新数据没有被清空
    expect((db.prepare("SELECT COUNT(*) as n FROM time_entries").get() as { n: number }).n).toBe(1);
  });

  it("rolls back business deletes and the migration marker when ledger recording fails", () => {
    const db = makeTestDb();
    const now = "2026-05-14T00:00:00.000Z";
    db.prepare(`
      INSERT INTO categories (id, name, color, created_at, updated_at)
      VALUES ('custom-cat', '自定义', '#000000', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at)
      VALUES ('entry-rollback', 'custom-cat', ?, ?, ?, ?)
    `).run(now, "2026-05-14T01:00:00.000Z", now, now);
    db.exec(`
      CREATE TRIGGER fail_utc_reset_seq
      BEFORE INSERT ON sync_seq
      BEGIN
        SELECT RAISE(ABORT, 'injected seq failure');
      END;
    `);

    expect(() => runUtcResetIfNeeded(db)).toThrow("injected seq failure");

    expect(db.prepare("SELECT id FROM categories WHERE id = 'custom-cat'").get()).toEqual({ id: "custom-cat" });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = 'entry-rollback'").get()).toEqual({
      id: "entry-rollback",
    });
    expect(db.prepare("SELECT value FROM app_metadata WHERE key = 'utc_reset_v1'").get()).toBeUndefined();
    expect((db.prepare("SELECT COUNT(*) as n FROM sync_tombstones").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM sync_seq").get() as { n: number }).n).toBe(0);
  });
});
