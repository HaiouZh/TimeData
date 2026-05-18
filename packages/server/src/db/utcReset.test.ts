import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runUtcResetIfNeeded } from "./utcReset.js";
import { computeAndPersistCommitHash, getCommitHash } from "../sync/state.js";

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
  `);
  return db;
}

describe("runUtcResetIfNeeded", () => {
  it("clears business data and seeds defaults on first run", () => {
    const db = makeTestDb();
    // 插入旧数据
    db.prepare(
      "INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("e1", "c1", "2026-05-13T15:00:00", "2026-05-13T16:00:00", new Date().toISOString(), new Date().toISOString());
    db.prepare(
      "INSERT INTO sync_logs (action) VALUES (?)"
    ).run("push");
    db.prepare(
      "INSERT INTO sync_tombstones (table_name, record_id, deleted_at) VALUES (?, ?, ?)"
    ).run("time_entries", "e1", new Date().toISOString());
    computeAndPersistCommitHash(db);

    const result = runUtcResetIfNeeded(db);

    expect(result.ran).toBe(true);
    expect(result.resetAt).toBeTruthy();
    expect((db.prepare("SELECT COUNT(*) as n FROM time_entries").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM sync_logs").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM sync_tombstones").get() as { n: number }).n).toBe(0);
    // 默认分类已重建
    expect((db.prepare("SELECT COUNT(*) as n FROM categories").get() as { n: number }).n).toBeGreaterThan(0);
    // 标记已写入
    const flag = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get("utc_reset_v1") as { value: string } | undefined;
    expect(flag?.value).toBeTruthy();
    expect(getCommitHash(db).latestSeq).toBeNull();
  });

  it("does NOT run reset on subsequent calls (idempotent)", () => {
    const db = makeTestDb();
    runUtcResetIfNeeded(db);
    // 插入新数据（模拟重置后正常写入的 UTC 记录）
    db.prepare(
      "INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("e2", "cat1", "2026-05-14T07:00:00.000Z", "2026-05-14T08:00:00.000Z", new Date().toISOString(), new Date().toISOString());

    const result = runUtcResetIfNeeded(db);

    expect(result.ran).toBe(false);
    // 新数据没有被清空
    expect((db.prepare("SELECT COUNT(*) as n FROM time_entries").get() as { n: number }).n).toBe(1);
  });
});
