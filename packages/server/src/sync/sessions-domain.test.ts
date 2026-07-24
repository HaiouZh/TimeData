import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncChange } from "@timedata/shared";

function change(action: "create" | "update" | "delete", id: string, endedAt: string | null = null): SyncChange {
  return {
    tableName: "sessions",
    recordId: id,
    action,
    timestamp: "2026-07-24T01:00:00.000Z",
    data:
      action === "delete"
        ? null
        : {
            id,
            startedAt: "2026-07-24T01:00:00.000Z",
            endedAt,
            note: null,
            createdAt: "2026-07-24T01:00:00.000Z",
            updatedAt: "2026-07-24T01:00:00.000Z",
          },
  } as unknown as SyncChange;
}

describe("sessions sync domain", () => {
  let db: InstanceType<typeof Database>;
  let domains: typeof import("./domains.js");
  let applyChange: typeof import("./resolver.js").applyChange;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
  afterEach(() => {
    db.close();
    vi.doUnmock("../db/connection.js");
  });

  it("create → readRecord → update ended_at → delete tombstone", () => {
    expect(applyChange(change("create", "s1")).status).toBe("applied");
    const pulled = domains.SERVER_SYNC_DOMAINS.sessions.readRecord(db, "s1");
    expect(pulled).toMatchObject({ tableName: "sessions", recordId: "s1", data: { endedAt: null } });

    expect(applyChange(change("update", "s1", "2026-07-24T03:00:00.000Z")).status).toBe("applied");
    expect(db.prepare("SELECT ended_at FROM sessions WHERE id='s1'").get()).toMatchObject({
      ended_at: "2026-07-24T03:00:00.000Z",
    });

    expect(applyChange(change("delete", "s1")).status).toBe("applied");
    expect(db.prepare("SELECT id FROM sessions WHERE id='s1'").get()).toBeUndefined();
    expect(db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name='sessions'").get()).toBeDefined();
  });
});
