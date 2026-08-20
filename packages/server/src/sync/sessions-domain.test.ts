import type { SyncChange } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRow } from "../lib/session-rows.js";
import { rowToSession, sessionToRow } from "../lib/session-rows.js";

function change(
  action: "create" | "update" | "delete",
  id: string,
  endedAt: string | null = null,
  trackIds: string[] = [],
): SyncChange {
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
            trackIds,
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
        track_ids TEXT NOT NULL DEFAULT '[]',
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

  it("push→pull e2e 带 trackIds 存活", () => {
    expect(applyChange(change("create", "s1", null, ["track-1", "track-2"])).status).toBe("applied");
    const pulled = domains.SERVER_SYNC_DOMAINS.sessions.readRecord(db, "s1");
    expect((pulled?.data as { trackIds: string[] }).trackIds).toEqual(["track-1", "track-2"]);
    expect(db.prepare("SELECT track_ids FROM sessions WHERE id='s1'").get()).toMatchObject({
      track_ids: JSON.stringify(["track-1", "track-2"]),
    });

    expect(applyChange(change("update", "s1", null, [])).status).toBe("applied");
    const pulled2 = domains.SERVER_SYNC_DOMAINS.sessions.readRecord(db, "s1");
    expect((pulled2?.data as { trackIds: string[] }).trackIds).toEqual([]);
  });
});

describe("session rows round-trip", () => {
  it("带值 / 空数组往返", () => {
    const session = {
      id: "s1",
      startedAt: "2026-07-24T01:00:00.000Z",
      endedAt: null,
      note: null,
      trackIds: ["track-1", "track-2"],
      createdAt: "2026-07-24T01:00:00.000Z",
      updatedAt: "2026-07-24T01:00:00.000Z",
    };
    const row = sessionToRow(session) as Record<string, string | null>;
    expect(row.track_ids).toBe(JSON.stringify(["track-1", "track-2"]));
    const restored = rowToSession({ ...row, updated_at: session.updatedAt } as never);
    expect(restored.trackIds).toEqual(["track-1", "track-2"]);

    const empty = { ...session, trackIds: [] as string[] };
    const rowEmpty = sessionToRow(empty) as Record<string, string | null>;
    expect(rowEmpty.track_ids).toBe("[]");
    const restoredEmpty = rowToSession({ ...rowEmpty, updated_at: empty.updatedAt } as never);
    expect(restoredEmpty.trackIds).toEqual([]);
  });

  it("坏 JSON 回退 []", () => {
    const now = "2026-07-24T01:00:00.000Z";
    const base = {
      id: "s1",
      started_at: now,
      ended_at: null,
      note: null,
      created_at: now,
      updated_at: now,
    } as unknown as SessionRow;
    expect(rowToSession({ ...base, track_ids: "not-json" } as never).trackIds).toEqual([]);
    expect(rowToSession({ ...base, track_ids: '"not-array"' } as never).trackIds).toEqual([]);
    expect(rowToSession({ ...base, track_ids: JSON.stringify(["ok", 123]) } as never).trackIds).toEqual([]);
    expect(rowToSession({ ...base, track_ids: JSON.stringify({ a: 1 }) } as never).trackIds).toEqual([]);
    expect(rowToSession({ ...base, track_ids: null as unknown as string } as never).trackIds).toEqual([]);
  });
});
