import type { SyncChange } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;
let applyChange: (change: SyncChange) => {
  status: string;
  reason: string;
  skipReason?: string;
  overriddenRecordIds?: string[];
};
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
      updated_at TEXT NOT NULL,
      source TEXT,
      source_label TEXT,
      pinned INTEGER NOT NULL DEFAULT 0
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
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-1",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "server",
      "2026-05-08T09:00:00",
      "2026-05-08T12:00:00",
    );

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
    expect(db.prepare("SELECT note, end_time FROM time_entries WHERE id = ?").get("entry-1")).toMatchObject(
      {
        note: "local wins",
        end_time: "2026-05-08T10:30:00",
      },
    );
  });

  it("assigns server time to updated_at instead of client change timestamp", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-1",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "server",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );

    // 模拟时钟漂移严重的客户端：change.timestamp 是很久以前。
    const timestamp = "2020-01-01T00:00:00.000Z";
    const before = new Date().toISOString();
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

    const row = db.prepare("SELECT updated_at FROM time_entries WHERE id = ?").get("entry-1") as { updated_at: string };
    expect(row.updated_at > timestamp).toBe(true);
    expect(row.updated_at >= before).toBe(true);
  });

  it("deletes overlapping remote entries before inserting a local entry", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "remote-overlap",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "remote",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );

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

    expect(result).toMatchObject({
      status: "applied",
      reason: "inserted entry",
      overriddenRecordIds: ["remote-overlap"],
    });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("remote-overlap")).toBeUndefined();
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("local-entry")).toMatchObject({
      id: "local-entry",
    });
  });

  it("records tombstone and seq for entries deleted by overlap resolution", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "remote-overlap",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "remote",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );

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
    expect(
      db
        .prepare("SELECT table_name, record_id, deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?")
        .get("time_entries", "remote-overlap"),
    ).toMatchObject({
      table_name: "time_entries",
      record_id: "remote-overlap",
    });
    expect(
      db
        .prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name = ? AND record_id = ?")
        .get("time_entries", "remote-overlap"),
    ).toMatchObject({
      table_name: "time_entries",
      record_id: "remote-overlap",
      action: "delete",
    });
  });

  it("records tombstone, seq, and overridden ids for entries deleted by category cascade", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "parent-cat",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("child-cat", "深度工作", "parent-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "parent-entry",
      "parent-cat",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "parent",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "child-entry",
      "child-cat",
      "2026-05-08T10:00:00",
      "2026-05-08T11:00:00",
      "child",
      "2026-05-08T10:00:00",
      "2026-05-08T10:00:00",
    );

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
    expect(
      db
        .prepare(
          "SELECT table_name, record_id, deleted_at FROM sync_tombstones WHERE table_name = ? ORDER BY record_id",
        )
        .all("time_entries"),
    ).toMatchObject([
      { table_name: "time_entries", record_id: "child-entry" },
      { table_name: "time_entries", record_id: "parent-entry" },
    ]);
    expect(
      db
        .prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name = ? ORDER BY record_id")
        .all("time_entries"),
    ).toEqual([
      { table_name: "time_entries", record_id: "child-entry", action: "delete" },
      { table_name: "time_entries", record_id: "parent-entry", action: "delete" },
    ]);
  });

  it("records seq for every category deleted by category cascade", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "parent-cat",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("child-cat", "深度工作", "parent-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("grandchild-cat", "写作", "child-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");

    const baseSeq = db.prepare("SELECT MAX(id) AS max_id FROM sync_seq").get() as { max_id: number | null };

    const result = applyChange({
      tableName: "categories",
      recordId: "parent-cat",
      action: "delete",
      timestamp: "2026-05-08T12:00:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "deleted category" });
    expect(
      db.prepare("SELECT id FROM categories WHERE id IN (?, ?, ?)").all("parent-cat", "child-cat", "grandchild-cat"),
    ).toEqual([]);
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

  it("applies settings upsert and delete", () => {
    const up = applyChange({
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "update",
      data: { key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" },
      timestamp: "2026-05-30T01:00:00.000Z",
    });

    expect(up.status).toBe("applied");
    expect(db.prepare("SELECT value FROM settings WHERE key = ?").get("sleep.categoryId")).toMatchObject({
      value: "cat-1",
    });

    const del = applyChange({
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "delete",
      data: null,
      timestamp: "2026-05-30T02:00:00.000Z",
    });

    expect(del.status).toBe("applied");
    expect(db.prepare("SELECT key FROM settings WHERE key = ?").get("sleep.categoryId")).toBeUndefined();
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'settings' AND record_id = ?").get("sleep.categoryId"),
    ).toBeDefined();
  });

  it("applies quick note upsert and delete without category dependencies", () => {
    const up = applyChange({
      tableName: "quick_notes",
      recordId: "note-1",
      action: "create",
      data: {
        id: "note-1",
        text: "repo",
        occurredAt: "2026-06-01T04:01:30.123Z",
        createdAt: "2026-06-01T04:02:00.000Z",
        updatedAt: "2026-06-01T04:02:00.000Z",
      },
      timestamp: "2026-06-01T04:02:00.000Z",
    });

    expect(up.status).toBe("applied");
    expect(db.prepare("SELECT text, occurred_at, updated_at FROM quick_notes WHERE id = ?").get("note-1")).toMatchObject({
      text: "repo",
      occurred_at: "2026-06-01T04:01:30.123Z",
      // updated_at 由服务器分配，只验证为合法 UTC ISO 格式。
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });

    const del = applyChange({
      tableName: "quick_notes",
      recordId: "note-1",
      action: "delete",
      data: null,
      timestamp: "2026-06-01T04:03:00.000Z",
    });

    expect(del.status).toBe("applied");
    expect(db.prepare("SELECT id FROM quick_notes WHERE id = ?").get("note-1")).toBeUndefined();
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'quick_notes' AND record_id = ?").get("note-1"),
    ).toBeDefined();
  });

  it("persists quick note source metadata on upsert", () => {
    const result = applyChange({
      tableName: "quick_notes",
      recordId: "note-agent",
      action: "create",
      data: {
        id: "note-agent",
        text: "周报已生成",
        occurredAt: "2026-06-03T01:00:00.000Z",
        createdAt: "2026-06-03T01:00:00.000Z",
        updatedAt: "2026-06-03T01:00:00.000Z",
        source: "agent",
        sourceLabel: "Hermes",
      },
      timestamp: "2026-06-03T01:00:00.000Z",
    });

    expect(result.status).toBe("applied");
    expect(db.prepare("SELECT source, source_label FROM quick_notes WHERE id = ?").get("note-agent")).toMatchObject({
      source: "agent",
      source_label: "Hermes",
    });
  });

  it("persists quick note pinned state on upsert", () => {
    const result = applyChange({
      tableName: "quick_notes",
      recordId: "note-pin",
      action: "create",
      data: {
        id: "note-pin",
        text: "重要",
        occurredAt: "2026-06-03T01:00:00.000Z",
        createdAt: "2026-06-03T01:00:00.000Z",
        updatedAt: "2026-06-03T01:00:00.000Z",
        pinned: true,
      },
      timestamp: "2026-06-03T01:00:00.000Z",
    });

    expect(result.status).toBe("applied");
    expect(db.prepare("SELECT pinned FROM quick_notes WHERE id = ?").get("note-pin")).toMatchObject({
      pinned: 1,
    });

    applyChange({
      tableName: "quick_notes",
      recordId: "note-pin",
      action: "update",
      data: {
        id: "note-pin",
        text: "重要",
        occurredAt: "2026-06-03T01:00:00.000Z",
        createdAt: "2026-06-03T01:00:00.000Z",
        updatedAt: "2026-06-03T02:00:00.000Z",
        pinned: false,
      },
      timestamp: "2026-06-03T02:00:00.000Z",
    });

    expect(db.prepare("SELECT pinned FROM quick_notes WHERE id = ?").get("note-pin")).toMatchObject({
      pinned: 0,
    });
  });
});
