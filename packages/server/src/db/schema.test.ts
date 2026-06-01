import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;

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
    ]);
  });
});
