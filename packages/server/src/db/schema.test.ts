import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;

function quickNoteColumnNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>).map((column) => column.name));
}

function taskColumnNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
}

beforeEach(async () => {
  db = new Database(":memory:");
  vi.resetModules();
  vi.doMock("./connection.js", () => ({ getDb: () => db }));
});

afterEach(() => {
  db.close();
  vi.doUnmock("./connection.js");
});

describe("initializeDatabase", () => {
  it("creates indexes for timeline, category hierarchy, tombstones, and sync sequence lookups", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{
      name: string;
    }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "idx_entries_start",
        "idx_entries_end",
        "idx_categories_parent",
        "idx_quick_notes_occurred_at",
        "idx_quick_notes_updated_at",
        "idx_sync_logs_timestamp",
        "idx_sync_tombstones_deleted_at",
        "idx_sync_seq_table_record",
      ]),
    );
  });

  it("creates sync_state for persisted sync commit hash state", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_state'").get();
    expect(table).toMatchObject({ name: "sync_state" });

    const columns = db.prepare("PRAGMA table_info(sync_state)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(columns.map((column) => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ["key", "TEXT", 0, 1],
      ["value", "TEXT", 1, 0],
      ["updated_at", "TEXT", 1, 0],
    ]);
  });

  it("creates quick_notes as an independent synced table", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'quick_notes'").get();
    expect(table).toMatchObject({ name: "quick_notes" });

    const columns = db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(columns.map((column) => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ["id", "TEXT", 0, 1],
      ["text", "TEXT", 1, 0],
      ["occurred_at", "TEXT", 1, 0],
      ["created_at", "TEXT", 1, 0],
      ["updated_at", "TEXT", 1, 0],
      ["source", "TEXT", 0, 0],
      ["source_label", "TEXT", 0, 0],
      ["pinned", "INTEGER", 1, 0],
    ]);
  });

  it("creates health_charts as a synced config table", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'health_charts'").get();
    expect(table).toMatchObject({ name: "health_charts" });

    const columns = db.prepare("PRAGMA table_info(health_charts)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(columns.map((column) => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ["id", "TEXT", 0, 1],
      ["type", "TEXT", 1, 0],
      ["sort_order", "INTEGER", 1, 0],
      ["config", "TEXT", 1, 0],
      ["created_at", "TEXT", 1, 0],
      ["updated_at", "TEXT", 1, 0],
    ]);

    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_health_charts_sort'").get();
    expect(index).toMatchObject({ name: "idx_health_charts_sort" });
  });

  it("adds source columns to legacy quick_notes tables", async () => {
    const { ensureQuickNoteSourceColumns } = await import("./schema.js");
    db.exec(`
      CREATE TABLE quick_notes (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    ensureQuickNoteSourceColumns(db);

    const columns = quickNoteColumnNames(db);
    expect(columns.has("source")).toBe(true);
    expect(columns.has("source_label")).toBe(true);
  });

  it("keeps the source column migration idempotent", async () => {
    const { ensureQuickNoteSourceColumns } = await import("./schema.js");
    db.exec(`
      CREATE TABLE quick_notes (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source TEXT,
        source_label TEXT
      );
    `);

    expect(() => {
      ensureQuickNoteSourceColumns(db);
      ensureQuickNoteSourceColumns(db);
    }).not.toThrow();
  });

  it("adds pinned to legacy quick_notes tables", async () => {
    const { ensureQuickNotePinnedColumn } = await import("./schema.js");
    db.exec(`
      CREATE TABLE quick_notes (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    ensureQuickNotePinnedColumn(db);

    const columns = quickNoteColumnNames(db);
    expect(columns.has("pinned")).toBe(true);
  });

  it("upgrades a legacy tasks table without scheduled_at and creates its index", async () => {
    // Reproduces the production crash: tasks table predates scheduled_at.
    db.exec(`
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
    `);

    const { initializeDatabase } = await import("./schema.js");
    expect(() => initializeDatabase()).not.toThrow();

    const columns = new Set(
      (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(columns.has("scheduled_at")).toBe(true);

    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_scheduled_at'")
      .get();
    expect(index).toMatchObject({ name: "idx_tasks_scheduled_at" });
  });

  it("keeps the task scheduled-columns migration idempotent", async () => {
    const { ensureTaskScheduledColumns } = await import("./schema.js");
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        recurrence TEXT,
        last_done_at TEXT,
        start_at TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        scheduled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    expect(() => {
      ensureTaskScheduledColumns(db);
      ensureTaskScheduledColumns(db);
    }).not.toThrow();
  });

  it("ensureTaskParentIdColumn adds parent_id and index", async () => {
    const { ensureTaskParentIdColumn } = await import("./schema.js");
    db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)");

    ensureTaskParentIdColumn(db);
    ensureTaskParentIdColumn(db);

    const columns = taskColumnNames(db);
    expect(columns.has("parent_id")).toBe(true);

    const indexes = (db.prepare("PRAGMA index_list(tasks)").all() as Array<{ name: string }>).map((row) => row.name);
    expect(indexes).toContain("idx_tasks_parent_id");
  });

  it("给缺 completed_count 的旧 tasks 表补列", async () => {
    const { ensureTaskCompletedCountColumn } = await import("./schema.js");
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        recurrence TEXT,
        last_done_at TEXT,
        start_at TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        scheduled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    ensureTaskCompletedCountColumn(db);
    ensureTaskCompletedCountColumn(db);

    const columns = new Set(
      (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(columns.has("completed_count")).toBe(true);
  });

  it("creates tasks with completed_at and tags columns", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const columns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["completed_at", "tags"]));
    expect(columns.find((column) => column.name === "tags")).toMatchObject({
      type: "TEXT",
      notnull: 1,
      dflt_value: "'[]'",
    });
  });

  it("给缺 completed_at/tags 的旧 tasks 表补列", async () => {
    const { ensureTaskCompletionMetadataColumns } = await import("./schema.js");
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        recurrence TEXT,
        last_done_at TEXT,
        start_at TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        scheduled_at TEXT,
        completed_count INTEGER NOT NULL DEFAULT 0,
        turn TEXT,
        turn_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    ensureTaskCompletionMetadataColumns(db);
    ensureTaskCompletionMetadataColumns(db);

    const columns = taskColumnNames(db);
    expect(columns.has("completed_at")).toBe(true);
    expect(columns.has("tags")).toBe(true);
  });

  it("keeps the pinned column migration idempotent", async () => {
    const { ensureQuickNotePinnedColumn } = await import("./schema.js");
    db.exec(`
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
    `);

    expect(() => {
      ensureQuickNotePinnedColumn(db);
      ensureQuickNotePinnedColumn(db);
    }).not.toThrow();
  });
});
