import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let app: typeof import("./tasks.js").default;
let db: Database.Database;

beforeEach(async () => {
  db = new Database(":memory:");
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
  db.prepare(`
    INSERT INTO tasks (id, title, done, recurrence, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("t1", "池任务", 0, null, 0, "2026-06-14T00:00:00.000Z", "2026-06-14T00:00:00.000Z");
  db.prepare(`
    INSERT INTO tasks (id, title, done, recurrence, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "t2",
    "周跑",
    0,
    JSON.stringify({ freq: "weekly", interval: 1, byWeekday: [1], basis: "due" }),
    1,
    "2026-06-14T00:00:00.000Z",
    "2026-06-14T00:00:00.000Z",
  );
  db.prepare(`
    INSERT INTO tasks (id, title, done, recurrence, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("t3", "完成项", 1, null, 2, "2026-06-14T00:00:00.000Z", "2026-06-14T00:00:00.000Z");

  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db }));
  app = (await import("./tasks.js")).default;
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

describe("GET /api/tasks (read-only)", () => {
  it("returns all tasks", async () => {
    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tasks).toHaveLength(3);
  });

  it("filters kind=recurring", async () => {
    const res = await app.request("/?kind=recurring");
    const body = await res.json();

    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t2"]);
  });

  it("filters kind=pool", async () => {
    const res = await app.request("/?kind=pool");
    const body = await res.json();

    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t1", "t3"]);
  });

  it("filters done status", async () => {
    const res = await app.request("/?done=1");
    const body = await res.json();

    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t3"]);
  });

  it("rejects unknown query parameters", async () => {
    const res = await app.request("/?write=1");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });
});
