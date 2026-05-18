import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncChange } from "@timedata/shared";

let db: Database.Database;
let applyChange: (change: SyncChange) => { status: string; reason: string; skipReason?: string; overriddenRecordIds?: string[] };
let getChangesSinceSeq: (sinceSeq: number | null) => Array<{ tableName: string; recordId: string; action: string }>;

beforeEach(async () => {
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

    CREATE TABLE sync_tombstones (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    );

    CREATE TABLE sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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
  ({ applyChange } = await import("./resolver.js"));
  ({ getChangesSinceSeq } = await import("./seq.js"));
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

describe("applyChange", () => {
  it("does not create placeholder categories for entry sync", () => {
    const result = applyChange({
      tableName: "time_entries",
      recordId: "entry-missing-category",
      action: "create",
      data: {
        id: "entry-missing-category",
        categoryId: "missing-category",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
      timestamp: "2026-05-08T09:00:00",
    });

    const category = db.prepare("SELECT id FROM categories WHERE id = ?").get("missing-category");
    const entry = db.prepare("SELECT id FROM time_entries WHERE id = ?").get("entry-missing-category");

    expect(result).toMatchObject({ status: "skipped", reason: "missing category", skipReason: "missing_category" });
    expect(category).toBeUndefined();
    expect(entry).toBeUndefined();
  });

  it("updates an existing entry even when the server timestamp is newer", () => {
    db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run("cat-1", "工作", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("entry-1", "cat-1", "2026-05-08T09:00:00", "2026-05-08T10:00:00", "server", "2026-05-08T09:00:00", "2026-05-08T12:00:00");

    const result = applyChange({
      tableName: "time_entries",
      recordId: "entry-1",
      action: "update",
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:30:00",
        note: "local wins",
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T10:30:00",
      },
      timestamp: "2026-05-08T10:30:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "updated entry" });
    expect(db.prepare("SELECT note, end_time, updated_at FROM time_entries WHERE id = ?").get("entry-1")).toMatchObject({
      note: "local wins",
      end_time: "2026-05-08T10:30:00",
      updated_at: "2026-05-08T10:30:00",
    });
  });

  it("uses change timestamp instead of payload updatedAt for server updated_at", () => {
    db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run("cat-1", "工作", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("entry-1", "cat-1", "2026-05-08T09:00:00", "2026-05-08T10:00:00", "server", "2026-05-08T09:00:00", "2026-05-08T09:00:00");

    const timestamp = "2026-06-01T00:00:00.000Z";
    applyChange({
      tableName: "time_entries",
      recordId: "entry-1",
      action: "update",
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:30:00",
        note: "local wins",
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "1970-01-01T00:00:00.000Z",
      },
      timestamp,
    });

    expect(db.prepare("SELECT updated_at FROM time_entries WHERE id = ?").get("entry-1")).toMatchObject({
      updated_at: timestamp,
    });
  });

  it("deletes overlapping remote entries before inserting a local entry", () => {
    db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run("cat-1", "工作", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("remote-overlap", "cat-1", "2026-05-08T09:00:00", "2026-05-08T10:00:00", "remote", "2026-05-08T09:00:00", "2026-05-08T09:00:00");

    const result = applyChange({
      tableName: "time_entries",
      recordId: "local-entry",
      action: "create",
      data: {
        id: "local-entry",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00",
        endTime: "2026-05-08T10:30:00",
        note: "local",
        createdAt: "2026-05-08T09:30:00",
        updatedAt: "2026-05-08T09:30:00",
      },
      timestamp: "2026-05-08T09:30:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "inserted entry", overriddenRecordIds: ["remote-overlap"] });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("remote-overlap")).toBeUndefined();
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("local-entry")).toMatchObject({ id: "local-entry" });
  });

  it("records tombstone and seq for entries deleted by overlap resolution", () => {
    db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run("cat-1", "工作", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("remote-overlap", "cat-1", "2026-05-08T09:00:00", "2026-05-08T10:00:00", "remote", "2026-05-08T09:00:00", "2026-05-08T09:00:00");

    const result = applyChange({
      tableName: "time_entries",
      recordId: "local-entry",
      action: "create",
      data: {
        id: "local-entry",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00",
        endTime: "2026-05-08T10:30:00",
        note: "local",
        createdAt: "2026-05-08T09:30:00",
        updatedAt: "2026-05-08T09:30:00",
      },
      timestamp: "2026-05-08T09:30:00",
    });

    expect(result).toMatchObject({ status: "applied", overriddenRecordIds: ["remote-overlap"] });
    expect(db.prepare("SELECT table_name, record_id, deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get("time_entries", "remote-overlap")).toMatchObject({
      table_name: "time_entries",
      record_id: "remote-overlap",
      deleted_at: "2026-05-08T09:30:00",
    });
    expect(db.prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name = ? AND record_id = ?").get("time_entries", "remote-overlap")).toMatchObject({
      table_name: "time_entries",
      record_id: "remote-overlap",
      action: "delete",
    });
  });

  it("records tombstone, seq, and overridden ids for entries deleted by category cascade", () => {
    db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run("parent-cat", "工作", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run("child-cat", "深度工作", "parent-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("parent-entry", "parent-cat", "2026-05-08T09:00:00", "2026-05-08T10:00:00", "parent", "2026-05-08T09:00:00", "2026-05-08T09:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("child-entry", "child-cat", "2026-05-08T10:00:00", "2026-05-08T11:00:00", "child", "2026-05-08T10:00:00", "2026-05-08T10:00:00");

    const result = applyChange({
      tableName: "categories",
      recordId: "parent-cat",
      action: "delete",
      timestamp: "2026-05-08T12:00:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "deleted category" });
    expect(result.overriddenRecordIds).toEqual(expect.arrayContaining(["parent-entry", "child-entry"]));
    expect(result.overriddenRecordIds).toHaveLength(2);
    expect(db.prepare("SELECT id FROM time_entries WHERE id IN (?, ?)").all("parent-entry", "child-entry")).toEqual([]);
    expect(db.prepare("SELECT table_name, record_id, deleted_at FROM sync_tombstones WHERE table_name = ? ORDER BY record_id").all("time_entries")).toEqual([
      { table_name: "time_entries", record_id: "child-entry", deleted_at: "2026-05-08T12:00:00" },
      { table_name: "time_entries", record_id: "parent-entry", deleted_at: "2026-05-08T12:00:00" },
    ]);
    expect(db.prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name = ? ORDER BY record_id").all("time_entries")).toEqual([
      { table_name: "time_entries", record_id: "child-entry", action: "delete" },
      { table_name: "time_entries", record_id: "parent-entry", action: "delete" },
    ]);
  });

  it("records seq for every category deleted by category cascade", () => {
    db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run("parent-cat", "工作", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run("child-cat", "深度工作", "parent-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run("grandchild-cat", "写作", "child-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");

    const baseSeq = db.prepare("SELECT MAX(id) AS max_id FROM sync_seq").get() as { max_id: number | null };

    const result = applyChange({
      tableName: "categories",
      recordId: "parent-cat",
      action: "delete",
      timestamp: "2026-05-08T12:00:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "deleted category" });
    expect(db.prepare("SELECT id FROM categories WHERE id IN (?, ?, ?)").all("parent-cat", "child-cat", "grandchild-cat")).toEqual([]);
    expect(getChangesSinceSeq(baseSeq.max_id)).toEqual([
      { id: expect.any(Number), tableName: "categories", recordId: "grandchild-cat", action: "delete" },
      { id: expect.any(Number), tableName: "categories", recordId: "child-cat", action: "delete" },
      { id: expect.any(Number), tableName: "categories", recordId: "parent-cat", action: "delete" },
    ]);
  });

  it("records seq on successful category create", () => {
    const result = applyChange({
      tableName: "categories",
      recordId: "test-cat-seq",
      action: "create",
      data: {
        id: "test-cat-seq",
        name: "Seq Test",
        parentId: null,
        color: "#000",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const seq = db.prepare("SELECT table_name, record_id, action FROM sync_seq").get();
    expect(result).toMatchObject({ status: "applied" });
    expect(seq).toMatchObject({ table_name: "categories", record_id: "test-cat-seq", action: "create" });
  });
});
