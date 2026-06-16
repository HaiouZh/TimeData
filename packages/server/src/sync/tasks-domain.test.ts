import type { SyncChange } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;
let applyChange: (change: SyncChange) => { status: string };
let domains: typeof import("./domains.js");

function change(action: "create" | "update" | "delete", id: string, title?: string): SyncChange {
  return {
    tableName: "tasks", recordId: id, action,
    data: action === "delete" ? null : {
      id, title, done: false, recurrence: null, lastDoneAt: null, startAt: null,
      scheduledAt: null, subtasks: [],
      completedCount: 0,
      sortOrder: 0, createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z",
    },
    timestamp: "2026-06-14T00:00:00.000Z",
  } as unknown as SyncChange;
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT, last_done_at TEXT, start_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, scheduled_at TEXT,
      subtasks TEXT NOT NULL DEFAULT '[]',
      completed_count INTEGER NOT NULL DEFAULT 0,
      turn TEXT, turn_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE sync_tombstones (table_name TEXT NOT NULL, record_id TEXT NOT NULL, deleted_at TEXT NOT NULL, PRIMARY KEY (table_name, record_id));
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE sync_seq (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db }));
  domains = await import("./domains.js");
  ({ applyChange } = await import("./resolver.js"));
});
afterEach(() => { db.close(); vi.doUnmock("../db/connection.js"); });

describe("tasks rides generic LWW pipeline with zero apply hook", () => {
  it("create → readRecord → update → delete tombstone", () => {
    expect(applyChange(change("create", "t1", "跑步")).status).toBe("applied");
    const pulled = domains.SERVER_SYNC_DOMAINS.tasks.readRecord(db, "t1");
    expect(pulled).toMatchObject({ tableName: "tasks", recordId: "t1", data: { title: "跑步", done: false } });

    expect(applyChange(change("update", "t1", "跑步2")).status).toBe("applied");
    expect(db.prepare("SELECT title FROM tasks WHERE id='t1'").get()).toMatchObject({ title: "跑步2" });

    expect(applyChange(change("delete", "t1")).status).toBe("applied");
    expect(db.prepare("SELECT id FROM tasks WHERE id='t1'").get()).toBeUndefined();
    expect(db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name='tasks'").get()).toBeDefined();
  });

  it("persists recurrence as JSON and round-trips it", () => {
    const c = change("create", "t2", "周跑");
    (c as unknown as { data: Record<string, unknown> }).data.recurrence = { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" };
    expect(applyChange(c).status).toBe("applied");
    const pulled = domains.SERVER_SYNC_DOMAINS.tasks.readRecord(db, "t2");
    expect(pulled).toMatchObject({ data: { recurrence: { freq: "weekly", byWeekday: [1] } } });
  });

  it("persists turn fields and round-trips them", () => {
    const c = change("create", "t3", "agent 跑");
    (c as unknown as { data: Record<string, unknown> }).data.turn = "running";
    (c as unknown as { data: Record<string, unknown> }).data.turnAt = "2026-06-16T01:00:00.000Z";

    expect(applyChange(c).status).toBe("applied");
    expect(db.prepare("SELECT turn, turn_at FROM tasks WHERE id='t3'").get()).toEqual({
      turn: "running",
      turn_at: "2026-06-16T01:00:00.000Z",
    });
    const pulled = domains.SERVER_SYNC_DOMAINS.tasks.readRecord(db, "t3");
    expect(pulled).toMatchObject({ data: { turn: "running", turnAt: "2026-06-16T01:00:00.000Z" } });
  });
});
