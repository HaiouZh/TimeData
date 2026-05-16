import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseConnectionToDefaults } from "./reset.js";

let db: Database.Database;

beforeEach(() => {
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
  `);
});

afterEach(() => {
  db.close();
});

describe("resetDatabaseConnectionToDefaults", () => {
  it("deletes entries and restores the default categories", () => {
    const now = "2026-05-06T00:00:00.000Z";
    db.prepare(`
      INSERT INTO categories (id, name, color, created_at, updated_at)
      VALUES ('custom-cat', '自定义', '#000000', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO categories (id, name, parent_id, color, created_at, updated_at)
      VALUES ('custom-child', '子分类', 'custom-cat', '#000000', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, created_at, updated_at)
      VALUES ('entry-1', 'custom-child', ?, ?, ?, ?)
    `).run(now, "2026-05-06T01:00:00.000Z", now, now);

    const result = resetDatabaseConnectionToDefaults(db);

    const entries = db.prepare("SELECT COUNT(*) as count FROM time_entries").get() as { count: number };
    const sleep = db.prepare("SELECT id, name FROM categories WHERE id = 'cat-sleep'").get() as { id: string; name: string };
    const custom = db.prepare("SELECT id FROM categories WHERE id = 'custom-cat'").get();

    expect(result.entriesDeleted).toBe(1);
    expect(result.categories).toBeGreaterThan(0);
    expect(entries.count).toBe(0);
    expect(sleep).toEqual({ id: "cat-sleep", name: "睡眠" });
    expect(custom).toBeUndefined();
  });
});
