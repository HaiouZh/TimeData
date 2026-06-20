import type { SyncChange, Track, TrackStep } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CREATE_NOW = "2026-06-21T00:00:00.000Z";
const UPDATE_NOW = "2026-06-21T00:01:00.000Z";
const DELETE_NOW = "2026-06-21T00:02:00.000Z";

let db: Database.Database;
let applyChange: (change: SyncChange) => { status: string; reason: string };
let validateSyncChanges: (db: Database.Database, changes: SyncChange[]) => { valid: boolean };
let orderPushChanges: (changes: SyncChange[]) => SyncChange[];
let getChangesSinceSeq: (sinceSeq: number | null) => Array<{
  id: number;
  tableName: string;
  recordId: string;
  action: string;
}>;
let domains: typeof import("./domains.js");

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    title: "T1 数据地基",
    status: "active",
    refs: [{ kind: "task", id: "task-1", label: "任务一" }],
    createdAt: CREATE_NOW,
    updatedAt: CREATE_NOW,
    ...overrides,
  };
}

function step(overrides: Partial<TrackStep> = {}): TrackStep {
  return {
    id: "step-1",
    trackId: "track-1",
    source: "agent",
    sourceLabel: "codex",
    content: "",
    startedAt: CREATE_NOW,
    endedAt: null,
    refs: [{ kind: "commit", id: "abc123" }],
    tags: ["phase:T1"],
    seq: 0,
    createdAt: CREATE_NOW,
    updatedAt: CREATE_NOW,
    ...overrides,
  };
}

function change(tableName: "tracks", action: "create" | "update" | "delete", data: Track | null): SyncChange;
function change(tableName: "track_steps", action: "create" | "update" | "delete", data: TrackStep | null): SyncChange;
function change(
  tableName: "tracks" | "track_steps",
  action: "create" | "update" | "delete",
  data: Track | TrackStep | null,
): SyncChange {
  return {
    tableName,
    recordId: tableName === "tracks" ? "track-1" : "step-1",
    action,
    data,
    timestamp: action === "delete" ? DELETE_NOW : (data?.updatedAt ?? CREATE_NOW),
  } as SyncChange;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(CREATE_NOW));
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE track_steps (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_label TEXT,
      content TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      refs TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      seq INTEGER NOT NULL,
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
  ({ validateSyncChanges } = await import("./validation.js"));
  ({ orderPushChanges } = await import("./order.js"));
  ({ getChangesSinceSeq } = await import("./seq.js"));
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.doUnmock("../db/connection.js");
});

describe("tracks sync roundtrip", () => {
  it("pushes track and step, pulls them by seq, and later pulls explicit tombstones", () => {
    const createTrack = change("tracks", "create", track());
    const createStep = change("track_steps", "create", step());

    expect(orderPushChanges([createStep, createTrack])).toEqual([createTrack, createStep]);
    expect(validateSyncChanges(db, [createTrack, createStep]).valid).toBe(true);
    expect(applyChange(createTrack)).toMatchObject({ status: "applied" });
    expect(applyChange(createStep)).toMatchObject({ status: "applied" });

    expect(db.prepare("SELECT title, refs, updated_at FROM tracks WHERE id = ?").get("track-1")).toMatchObject({
      title: "T1 数据地基",
      refs: JSON.stringify([{ kind: "task", id: "task-1", label: "任务一" }]),
      updated_at: CREATE_NOW,
    });
    expect(db.prepare("SELECT content, source_label, tags, updated_at FROM track_steps WHERE id = ?").get("step-1")).toMatchObject({
      content: "",
      source_label: "codex",
      tags: JSON.stringify(["phase:T1"]),
      updated_at: CREATE_NOW,
    });

    const afterCreate = getChangesSinceSeq(null);
    expect(afterCreate.map((item) => [item.tableName, item.recordId, item.action])).toEqual([
      ["tracks", "track-1", "create"],
      ["track_steps", "step-1", "create"],
    ]);
    const createSeq = afterCreate[0].id;

    expect(domains.SERVER_SYNC_DOMAINS.tracks.readRecord(db, "track-1")).toMatchObject({
      tableName: "tracks",
      recordId: "track-1",
      action: "update",
      timestamp: CREATE_NOW,
      data: { id: "track-1", title: "T1 数据地基", refs: [{ kind: "task", id: "task-1", label: "任务一" }] },
    });
    expect(domains.SERVER_SYNC_DOMAINS.track_steps.readRecord(db, "step-1")).toMatchObject({
      tableName: "track_steps",
      recordId: "step-1",
      action: "update",
      timestamp: CREATE_NOW,
      data: { id: "step-1", trackId: "track-1", content: "", tags: ["phase:T1"] },
    });

    vi.setSystemTime(new Date(UPDATE_NOW));
    expect(applyChange(change("track_steps", "update", step({ endedAt: UPDATE_NOW, updatedAt: UPDATE_NOW })))).toMatchObject({
      status: "applied",
    });
    expect(db.prepare("SELECT ended_at, updated_at FROM track_steps WHERE id = ?").get("step-1")).toMatchObject({
      ended_at: UPDATE_NOW,
      updated_at: UPDATE_NOW,
    });

    vi.setSystemTime(new Date(DELETE_NOW));
    const deleteStep = change("track_steps", "delete", null);
    const deleteTrack = change("tracks", "delete", null);
    expect(orderPushChanges([deleteTrack, deleteStep])).toEqual([deleteStep, deleteTrack]);
    expect(validateSyncChanges(db, [deleteStep, deleteTrack]).valid).toBe(true);
    expect(applyChange(deleteStep)).toMatchObject({ status: "applied" });
    expect(applyChange(deleteTrack)).toMatchObject({ status: "applied" });

    expect(db.prepare("SELECT id FROM track_steps WHERE id = ?").get("step-1")).toBeUndefined();
    expect(db.prepare("SELECT id FROM tracks WHERE id = ?").get("track-1")).toBeUndefined();
    expect(
      db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(
        "track_steps",
        "step-1",
      ),
    ).toMatchObject({ deleted_at: DELETE_NOW });
    expect(
      db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get("tracks", "track-1"),
    ).toMatchObject({ deleted_at: DELETE_NOW });

    expect(getChangesSinceSeq(createSeq).map((item) => [item.tableName, item.recordId, item.action])).toEqual([
      ["track_steps", "step-1", "delete"],
      ["tracks", "track-1", "delete"],
    ]);
  });
});
