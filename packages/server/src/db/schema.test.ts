import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;

function quickNoteColumnNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>).map((column) => column.name));
}

function taskColumnNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name));
}

function trackColumnNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("PRAGMA table_info(tracks)").all() as Array<{ name: string }>).map((column) => column.name));
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

  it("creates api_request_logs as a non-sync operational audit table", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'api_request_logs'").get();
    expect(table).toMatchObject({ name: "api_request_logs" });

    const columns = db.prepare("PRAGMA table_info(api_request_logs)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(columns.map((column) => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ["id", "INTEGER", 0, 1],
      ["timestamp", "TEXT", 1, 0],
      ["method", "TEXT", 1, 0],
      ["path", "TEXT", 1, 0],
      ["status", "INTEGER", 1, 0],
      ["outcome", "TEXT", 1, 0],
      ["token_tier", "TEXT", 1, 0],
      ["ip", "TEXT", 0, 0],
      ["user_agent", "TEXT", 0, 0],
      ["client_hint", "TEXT", 0, 0],
      ["device_label", "TEXT", 0, 0],
      ["duration_ms", "INTEGER", 1, 0],
    ]);

    const indexes = (db.prepare("PRAGMA index_list(api_request_logs)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(indexes).toEqual(expect.arrayContaining([
      "idx_api_request_logs_timestamp",
      "idx_api_request_logs_status",
      "idx_api_request_logs_outcome",
      "idx_api_request_logs_token_tier",
    ]));
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

  it("creates tracks and track_steps tables without SQL cascade", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const trackColumns = db.prepare("PRAGMA table_info(tracks)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(trackColumns.map((column) => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ["id", "TEXT", 0, 1],
      ["title", "TEXT", 1, 0],
      ["summary", "TEXT", 0, 0],
      ["status", "TEXT", 1, 0],
      ["refs", "TEXT", 1, 0],
      ["created_at", "TEXT", 1, 0],
      ["updated_at", "TEXT", 1, 0],
    ]);

    const stepColumns = db.prepare("PRAGMA table_info(track_steps)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(stepColumns.map((column) => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ["id", "TEXT", 0, 1],
      ["track_id", "TEXT", 1, 0],
      ["source", "TEXT", 1, 0],
      ["source_label", "TEXT", 0, 0],
      ["content", "TEXT", 1, 0],
      ["started_at", "TEXT", 1, 0],
      ["ended_at", "TEXT", 0, 0],
      ["refs", "TEXT", 1, 0],
      ["tags", "TEXT", 1, 0],
      ["seq", "INTEGER", 1, 0],
      ["created_at", "TEXT", 1, 0],
      ["updated_at", "TEXT", 1, 0],
    ]);

    const stepForeignKeys = db.prepare("PRAGMA foreign_key_list(track_steps)").all();
    expect(stepForeignKeys).toEqual([]);

    const indexes = (db.prepare("PRAGMA index_list(track_steps)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(indexes).toEqual(expect.arrayContaining(["idx_track_steps_track_id", "idx_track_steps_track_seq"]));
    const trackIndexes = (db.prepare("PRAGMA index_list(tracks)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(trackIndexes).toContain("idx_tracks_updated_at");
    expect(trackIndexes).not.toContain("idx_tracks_goal_id");
  });

  it("stores goal members on goals and does not keep member-side goal columns", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const taskColumns = taskColumnNames(db);
    const trackColumns = trackColumnNames(db);
    const goalColumns = new Set(
      (db.prepare("PRAGMA table_info(goals)").all() as Array<{ name: string }>).map((column) => column.name),
    );

    expect(taskColumns.has("goal_id")).toBe(false);
    expect(trackColumns.has("goal_id")).toBe(false);
    expect(goalColumns.has("members")).toBe(true);
    expect(goalColumns.has("prerequisites")).toBe(true);
  });

  it("creates goal_layout_pins with a composite primary key", async () => {
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();

    const columns = db.prepare("PRAGMA table_info(goal_layout_pins)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    expect(columns.map((column) => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ["goal_id", "TEXT", 1, 1],
      ["node_kind", "TEXT", 1, 2],
      ["node_id", "TEXT", 1, 3],
      ["x", "REAL", 1, 0],
      ["y", "REAL", 1, 0],
      ["updated_at", "TEXT", 1, 0],
    ]);

    const indexes = (db.prepare("PRAGMA index_list(goal_layout_pins)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(indexes).toContain("idx_goal_layout_pins_goal_id");
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

  it("ensureGoalMembersColumn adds members and is idempotent", async () => {
    const { ensureGoalMembersColumn } = await import("./schema.js");
    db.exec(`
      CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        prerequisites TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    ensureGoalMembersColumn(db);
    ensureGoalMembersColumn(db);

    const columns = new Set(
      (db.prepare("PRAGMA table_info(goals)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(columns.has("members")).toBe(true);
  });

  it("initializeDatabase drops retired goal_id columns and indexes from legacy member tables", async () => {
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
        parent_id TEXT,
        goal_id TEXT,
        completed_count INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_tasks_goal_id ON tasks(goal_id);
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL,
        refs TEXT NOT NULL DEFAULT '[]',
        goal_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_tracks_goal_id ON tracks(goal_id);
    `);
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();
    initializeDatabase();

    expect(taskColumnNames(db).has("goal_id")).toBe(false);
    expect(trackColumnNames(db).has("goal_id")).toBe(false);
    expect((db.prepare("PRAGMA index_list(tasks)").all() as Array<{ name: string }>).map((row) => row.name)).not.toContain("idx_tasks_goal_id");
    expect((db.prepare("PRAGMA index_list(tracks)").all() as Array<{ name: string }>).map((row) => row.name)).not.toContain("idx_tracks_goal_id");
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

  it("ensureTaskWeightColumn adds weight with zero default and is idempotent", async () => {
    const { ensureTaskWeightColumn } = await import("./schema.js");
    db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)");

    ensureTaskWeightColumn(db);
    ensureTaskWeightColumn(db);

    const columns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string; dflt_value: string | null }>;
    expect(columns.find((column) => column.name === "weight")?.dflt_value).toBe("0");
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

  it("initializeDatabase 删存量 tasks 的已退役状态列", async () => {
    const legacyTaskStateColumn = "tu" + "rn";
    const legacyTaskStateTimeColumn = `${legacyTaskStateColumn}_at`;
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
        parent_id TEXT,
        completed_count INTEGER NOT NULL DEFAULT 0,
        ${legacyTaskStateColumn} TEXT,
        ${legacyTaskStateTimeColumn} TEXT,
        completed_at TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const { initializeDatabase } = await import("./schema.js");

    initializeDatabase();
    initializeDatabase();

    const columns = taskColumnNames(db);
    expect(columns.has(legacyTaskStateColumn)).toBe(false);
    expect(columns.has(legacyTaskStateTimeColumn)).toBe(false);
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

describe("dropColumnsIfExist", () => {
  it("删存在列且幂等", async () => {
    const { dropColumnsIfExist } = await import("./schema.js");
    db.exec("CREATE TABLE demo (id TEXT PRIMARY KEY, keep_me TEXT, drop_me TEXT)");

    dropColumnsIfExist(db, "demo", ["drop_me"]);
    dropColumnsIfExist(db, "demo", ["drop_me"]);

    const cols = new Set((db.prepare("PRAGMA table_info(demo)").all() as Array<{ name: string }>).map((c) => c.name));
    expect(cols.has("keep_me")).toBe(true);
    expect(cols.has("drop_me")).toBe(false);
  });

  it("列不存在 -> no-op 不抛", async () => {
    const { dropColumnsIfExist } = await import("./schema.js");
    db.exec("CREATE TABLE demo (id TEXT PRIMARY KEY, keep_me TEXT)");

    expect(() => dropColumnsIfExist(db, "demo", ["missing"])).not.toThrow();

    const cols = new Set((db.prepare("PRAGMA table_info(demo)").all() as Array<{ name: string }>).map((c) => c.name));
    expect(cols.has("keep_me")).toBe(true);
  });

  it("带索引列：先删索引再删列", async () => {
    const { dropColumnsIfExist } = await import("./schema.js");
    db.exec("CREATE TABLE demo (id TEXT PRIMARY KEY, indexed_value TEXT, keep_me TEXT)");
    db.exec("CREATE INDEX idx_demo_indexed ON demo(indexed_value)");

    dropColumnsIfExist(db, "demo", ["indexed_value"], ["idx_demo_indexed"]);

    const cols = new Set((db.prepare("PRAGMA table_info(demo)").all() as Array<{ name: string }>).map((c) => c.name));
    expect(cols.has("indexed_value")).toBe(false);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_demo_indexed'").get();
    expect(idx).toBeUndefined();
  });
});
