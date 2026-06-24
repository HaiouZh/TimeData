import {
  encodeGoalLayoutPinKey,
  type GoalLayoutPin,
  type SyncChange,
} from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-06-24T00:00:00.000Z";
const LATER = "2026-06-24T00:05:00.000Z";

let db: Database.Database;
let applyChange: (change: SyncChange) => { status: string; reason: string };
let validateSyncChanges: (db: Database.Database, changes: SyncChange[]) => { valid: boolean };
let getChangesSinceSeq: (sinceSeq: number | null) => Array<{ tableName: string; recordId: string; action: string }>;
let domains: typeof import("./domains.js");

function pin(overrides: Partial<GoalLayoutPin> = {}): GoalLayoutPin {
  return {
    goalId: "goal-1",
    nodeKind: "goal",
    nodeId: "goal-1",
    x: 100,
    y: 200,
    updatedAt: NOW,
    ...overrides,
  };
}

function change(action: "create" | "update" | "delete", data: GoalLayoutPin | null): SyncChange {
  const recordId = data ? encodeGoalLayoutPinKey(data.goalId, data.nodeKind, data.nodeId) : "goal-1|goal|goal-1";
  return {
    tableName: "goal_layout_pins",
    recordId,
    action,
    data,
    timestamp: data?.updatedAt ?? LATER,
  } as SyncChange;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE goal_layout_pins (
      goal_id TEXT NOT NULL,
      node_kind TEXT NOT NULL,
      node_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, node_kind, node_id)
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
  ({ validateSyncChanges } = await import("./validation.js"));
  ({ getChangesSinceSeq } = await import("./seq.js"));
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.doUnmock("../db/connection.js");
});

describe("goal_layout_pins sync roundtrip", () => {
  it("validates recordId from the composite key", () => {
    expect(validateSyncChanges(db, [change("create", pin())]).valid).toBe(true);
    expect(
      validateSyncChanges(db, [
        { ...change("create", pin()), recordId: "wrong|goal|goal-1" } as SyncChange,
      ]).valid,
    ).toBe(false);
    expect(validateSyncChanges(db, [{ ...change("delete", null), recordId: "malformed" } as SyncChange]).valid).toBe(
      false,
    );
    expect(
      validateSyncChanges(db, [{ ...change("delete", null), recordId: "|goal|goal-1" } as SyncChange]).valid,
    ).toBe(false);
    expect(
      validateSyncChanges(db, [{ ...change("delete", null), recordId: "goal-1|goal|" } as SyncChange]).valid,
    ).toBe(false);
  });

  it("pushes, reads, updates, pulls by seq, and tombstones pins", () => {
    const recordId = "goal-1|goal|goal-1";

    expect(applyChange(change("create", pin())).status).toBe("applied");
    expect(db.prepare("SELECT goal_id, node_kind, node_id, x, y FROM goal_layout_pins").get()).toEqual({
      goal_id: "goal-1",
      node_kind: "goal",
      node_id: "goal-1",
      x: 100,
      y: 200,
    });
    expect(getChangesSinceSeq(null).map((item) => [item.tableName, item.recordId, item.action])).toEqual([
      ["goal_layout_pins", recordId, "create"],
    ]);

    expect(domains.SERVER_SYNC_DOMAINS.goal_layout_pins.readRecord(db, recordId)).toMatchObject({
      tableName: "goal_layout_pins",
      recordId,
      data: { goalId: "goal-1", nodeKind: "goal", nodeId: "goal-1", x: 100, y: 200 },
    });

    vi.setSystemTime(new Date(LATER));
    expect(applyChange(change("update", pin({ x: 120, y: 210, updatedAt: LATER }))).status).toBe("applied");
    expect(db.prepare("SELECT x, y, updated_at FROM goal_layout_pins WHERE goal_id = ?").get("goal-1")).toMatchObject({
      x: 120,
      y: 210,
      updated_at: LATER,
    });
    expect(getChangesSinceSeq(null).map((item) => [item.tableName, item.recordId, item.action])).toEqual([
      ["goal_layout_pins", recordId, "update"],
    ]);

    expect(applyChange(change("delete", null)).status).toBe("applied");
    expect(db.prepare("SELECT * FROM goal_layout_pins").get()).toBeUndefined();
    expect(db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'goal_layout_pins'").get()).toEqual({
      record_id: recordId,
    });
  });
});
