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

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      "idx_entries_start",
      "idx_entries_end",
      "idx_categories_parent",
      "idx_sync_logs_timestamp",
      "idx_sync_tombstones_deleted_at",
      "idx_sync_seq_table_record",
    ]));
  });
});
