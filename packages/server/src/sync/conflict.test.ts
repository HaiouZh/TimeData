import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;
let analyzePushBaseSeq: typeof import("./conflict.js").analyzePushBaseSeq;
let recordSeq: typeof import("./seq.js").recordSeq;

beforeEach(async () => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL
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


    CREATE TABLE sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db }));
  ({ analyzePushBaseSeq } = await import("./conflict.js"));
  ({ recordSeq } = await import("./seq.js"));
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

describe("analyzePushBaseSeq", () => {
  it("treats missing base seq as unknown base", () => {
    const analysis = analyzePushBaseSeq(null, [{ tableName: "categories", recordId: "cat-1" }]);

    expect(analysis).toEqual({ strategy: "unknown_base", cloudAheadCount: 0, overlappingRecords: [] });
  });

  it("allows fast-forward push when cloud has no changes after base seq", () => {
    const baseSeq = recordSeq("categories", "cat-1", "create");

    const analysis = analyzePushBaseSeq(baseSeq, [{ tableName: "categories", recordId: "cat-1" }]);

    expect(analysis).toEqual({ strategy: "fast_forward_push", cloudAheadCount: 0, overlappingRecords: [] });
  });

  it("allows non-overlapping merge when cloud changed different records after base seq", () => {
    const baseSeq = recordSeq("categories", "cat-1", "create");
    recordSeq("time_entries", "entry-cloud", "update");

    const analysis = analyzePushBaseSeq(baseSeq, [{ tableName: "categories", recordId: "cat-local" }]);

    expect(analysis).toEqual({ strategy: "merge_non_overlapping", cloudAheadCount: 1, overlappingRecords: [] });
  });

  it("uses local-wins non-fast-forward when cloud changed pushed records after base seq", () => {
    const baseSeq = recordSeq("categories", "cat-1", "create");
    const serverSeq = recordSeq("categories", "cat-1", "update");

    const analysis = analyzePushBaseSeq(baseSeq, [{ tableName: "categories", recordId: "cat-1" }]);

    expect(analysis).toEqual({
      strategy: "local_wins_non_fast_forward",
      cloudAheadCount: 1,
      overlappingRecords: [{ tableName: "categories", recordId: "cat-1", serverSeq }],
    });
  });

  it("includes quick_notes in overlap analysis", () => {
    const baseSeq = recordSeq("categories", "cat-1", "create");
    const serverSeq = recordSeq("quick_notes", "note-1", "update");

    const analysis = analyzePushBaseSeq(baseSeq, [{ tableName: "quick_notes", recordId: "note-1" }]);

    expect(analysis).toEqual({
      strategy: "local_wins_non_fast_forward",
      cloudAheadCount: 1,
      overlappingRecords: [{ tableName: "quick_notes", recordId: "note-1", serverSeq }],
    });
  });
});
