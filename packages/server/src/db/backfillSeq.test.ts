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

    const inserted = backfillMissingSeq(db);

    expect(inserted).toBe(4);
    expect(seqCount("categories", "cat-default")).toBe(1);
    expect(seqCount("time_entries", "e1")).toBe(1);
    expect(seqCount("settings", "sleep.categoryId")).toBe(1);
    expect(seqCount("quick_notes", "n1")).toBe(1);
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
