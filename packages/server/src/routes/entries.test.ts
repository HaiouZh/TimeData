import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;
let app: Hono;

function createSchema() {
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
}

function seed() {
  const now = "2026-05-07T00:00:00.000Z";
  db.prepare(`INSERT INTO categories (id, name, color, created_at, updated_at) VALUES ('cat-work', '工作', '#4A90D9', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES ('cat-code', '编程', 'cat-work', '#4A90D9', ?, ?)`).run(now, now);
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema();
  seed();
  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db }));
  const entriesRoute = (await import("./entries.js")).default;
  app = new Hono().route("/api/entries", entriesRoute);
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

describe("entries route", () => {
  it("preserves the existing bare array response by default", async () => {
    const res = await app.request("/api/entries?date=2026-05-07");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("wraps the response in { entries, total, hasMore } when v=2", async () => {
    const res = await app.request("/api/entries?date=2026-05-07&v=2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], total: 0, hasMore: false });
  });

  it("returns CLI list response when format=cli", async () => {
    const res = await app.request("/api/entries?date=2026-05-07&format=cli");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      date: "2026-05-07",
      entries: [],
      summary: { totalMinutes: 0, entryCount: 0 },
    });
  });

  it("creates one entry through POST", async () => {
    const res = await app.request("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-05-07",
        start: "14:00",
        end: "16:00",
        category: "工作/编程",
        note: "重构同步模块",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entry.category).toBe("工作/编程");
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const res = await app.request("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON",
      },
    });
  });
});
