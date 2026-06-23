import type { Goal, SyncChange } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-06-22T01:00:00.000Z";

let db: Database.Database;
let applyChange: (change: SyncChange) => { status: string; reason: string };
let domains: typeof import("./domains.js");

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    members: [
      { kind: "task", id: "task-1" },
      { kind: "track", id: "track-1" },
    ],
    prerequisites: [
      {
        blocker: { kind: "task", id: "task-1" },
        blocked: { kind: "track", id: "track-1" },
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function change(action: "create" | "update" | "delete", data: Goal | null): SyncChange {
  return {
    tableName: "goals",
    recordId: "goal-1",
    action,
    data,
    timestamp: data?.updatedAt ?? NOW,
  } as SyncChange;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      members TEXT NOT NULL DEFAULT '[]',
      prerequisites TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
  domains = await import("./domains.js");
  ({ applyChange } = await import("./resolver.js"));
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.doUnmock("../db/connection.js");
});

describe("goals sync roundtrip", () => {
  it("pushes, reads, updates, and tombstones goals through generic LWW", () => {
    expect(applyChange(change("create", goal())).status).toBe("applied");
    expect(domains.SERVER_SYNC_DOMAINS.goals.readRecord(db, "goal-1")).toMatchObject({
      tableName: "goals",
      recordId: "goal-1",
      data: {
        title: "发布 v2",
        kind: "project",
        members: [
          { kind: "task", id: "task-1" },
          { kind: "track", id: "track-1" },
        ],
        prerequisites: [
          {
            blocker: { kind: "task", id: "task-1" },
            blocked: { kind: "track", id: "track-1" },
          },
        ],
      },
    });

    expect(applyChange(change("update", goal({ title: "发布 v2.1", kind: "theme" }))).status).toBe("applied");
    expect(db.prepare("SELECT title, kind FROM goals WHERE id = ?").get("goal-1")).toEqual({
      title: "发布 v2.1",
      kind: "theme",
    });

    expect(applyChange(change("delete", null)).status).toBe("applied");
    expect(db.prepare("SELECT id FROM goals WHERE id = ?").get("goal-1")).toBeUndefined();
    expect(db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'goals'").get()).toEqual({
      record_id: "goal-1",
    });
  });
});
