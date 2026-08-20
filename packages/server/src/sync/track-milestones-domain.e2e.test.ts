import type { SyncChange, Track, TrackMilestone } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CREATE_NOW = "2026-06-21T00:00:00.000Z";
const UPDATE_NOW = "2026-06-21T00:01:00.000Z";
const DELETE_NOW = "2026-06-21T00:02:00.000Z";

let db: Database.Database;
let applyChange: (change: SyncChange, opts?: Record<string, unknown>) => { status: string; reason: string; skipReason?: string; serverUpdatedAt?: string };
let domains: typeof import("./domains.js");

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    title: "T1 数据地基",
    status: "active",
    refs: [],
    createdAt: CREATE_NOW,
    updatedAt: CREATE_NOW,
    ...overrides,
  };
}

function milestone(overrides: Partial<TrackMilestone> = {}): TrackMilestone {
  return {
    id: "ms-1",
    trackId: "track-1",
    title: "M1",
    status: "pending",
    note: null,
    taskId: null,
    position: 0,
    createdAt: CREATE_NOW,
    updatedAt: CREATE_NOW,
    ...overrides,
  };
}

function change(action: "create" | "update" | "delete", data: TrackMilestone | null, extra: Partial<SyncChange> = {}): SyncChange {
  return {
    tableName: "track_milestones",
    recordId: data?.id ?? "ms-1",
    action,
    data,
    timestamp: action === "delete" ? DELETE_NOW : (data?.updatedAt ?? CREATE_NOW),
    ...extra,
  } as SyncChange;
}

function trackChange(action: "create" | "update" | "delete", data: Track | null): SyncChange {
  return {
    tableName: "tracks",
    recordId: "track-1",
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
    CREATE TABLE track_milestones (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      task_id TEXT,
      position INTEGER NOT NULL,
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

describe("track_milestones sync domain", () => {
  it("合法 upsert 落库、读回字段逐一相符（含 note/taskId 为 null 与非 null 两形）", () => {
    expect(applyChange(trackChange("create", track()))).toMatchObject({ status: "applied" });

    const ms1 = milestone({ id: "ms-1", note: null, taskId: null, position: 0, title: "M1", status: "pending" });
    expect(applyChange(change("create", ms1))).toMatchObject({ status: "applied" });
    expect(db.prepare("SELECT id, track_id, title, status, note, task_id, position, created_at FROM track_milestones WHERE id = ?").get("ms-1")).toMatchObject({
      id: "ms-1",
      track_id: "track-1",
      title: "M1",
      status: "pending",
      note: null,
      task_id: null,
      position: 0,
      created_at: CREATE_NOW,
    });
    expect(domains.SERVER_SYNC_DOMAINS.track_milestones.readRecord(db, "ms-1")).toMatchObject({
      tableName: "track_milestones",
      recordId: "ms-1",
      action: "update",
      timestamp: CREATE_NOW,
      data: { id: "ms-1", trackId: "track-1", title: "M1", status: "pending", note: null, taskId: null, position: 0, createdAt: CREATE_NOW },
    });

    vi.setSystemTime(new Date(UPDATE_NOW));
    const ms2 = milestone({ id: "ms-2", note: "备注", taskId: "task-1", position: 1, title: "M2", status: "done", createdAt: UPDATE_NOW, updatedAt: UPDATE_NOW });
    expect(applyChange(change("create", ms2))).toMatchObject({ status: "applied" });
    expect(db.prepare("SELECT note, task_id, title, status, position FROM track_milestones WHERE id = ?").get("ms-2")).toMatchObject({
      note: "备注",
      task_id: "task-1",
      title: "M2",
      status: "done",
      position: 1,
    });
    expect(domains.SERVER_SYNC_DOMAINS.track_milestones.readRecord(db, "ms-2")).toMatchObject({
      tableName: "track_milestones",
      recordId: "ms-2",
      data: { id: "ms-2", trackId: "track-1", title: "M2", status: "done", note: "备注", taskId: "task-1", position: 1 },
    });
  });

  it("宿主 track 不存在的 upsert 被 skip 且 reason orphan_milestone_rejected", () => {
    const ms = milestone({ trackId: "ghost" });
    const result = applyChange(change("create", ms));
    expect(result).toMatchObject({ status: "skipped", skipReason: "orphan_milestone_rejected" });
    expect(db.prepare("SELECT id FROM track_milestones WHERE id = ?").get("ms-1")).toBeUndefined();

    // 宿主已删后 update 同样被拒
    expect(applyChange(trackChange("create", track()))).toMatchObject({ status: "applied" });
    expect(applyChange(change("create", milestone()))).toMatchObject({ status: "applied" });
    vi.setSystemTime(new Date(DELETE_NOW));
    expect(applyChange(trackChange("delete", null))).toMatchObject({ status: "applied" });
    vi.setSystemTime(new Date(UPDATE_NOW));
    const later = milestone({ updatedAt: UPDATE_NOW, title: "M1-updated" });
    const updateResult = applyChange(change("update", later));
    expect(updateResult).toMatchObject({ status: "skipped", skipReason: "orphan_milestone_rejected" });
  });

  it("delete 写 tombstone", () => {
    expect(applyChange(trackChange("create", track()))).toMatchObject({ status: "applied" });
    expect(applyChange(change("create", milestone()))).toMatchObject({ status: "applied" });
    vi.setSystemTime(new Date(DELETE_NOW));
    const del = change("delete", null);
    expect(applyChange(del)).toMatchObject({ status: "applied" });
    expect(db.prepare("SELECT id FROM track_milestones WHERE id = ?").get("ms-1")).toBeUndefined();
    expect(db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get("track_milestones", "ms-1")).toMatchObject({ deleted_at: DELETE_NOW });
    // readRecord 应返回 null
    expect(domains.SERVER_SYNC_DOMAINS.track_milestones.readRecord(db, "ms-1")).toBeNull();
  });

  it("LWW：旧 timestamp 的 upsert 不覆盖新行", () => {
    expect(applyChange(trackChange("create", track()))).toMatchObject({ status: "applied" });
    // 先写入较新的版本
    vi.setSystemTime(new Date(UPDATE_NOW));
    const newer = milestone({ title: "newer", updatedAt: UPDATE_NOW });
    expect(applyChange(change("create", newer))).toMatchObject({ status: "applied" });
    expect(db.prepare("SELECT title, updated_at FROM track_milestones WHERE id = ?").get("ms-1")).toMatchObject({ title: "newer", updated_at: UPDATE_NOW });

    // 再尝试用旧 timestamp 覆盖，应被 staleGuard 拒收
    const older = milestone({ title: "older", updatedAt: CREATE_NOW });
    const olderChange: SyncChange = {
      tableName: "track_milestones",
      recordId: "ms-1",
      action: "update",
      data: older,
      timestamp: CREATE_NOW,
    } as SyncChange;
    const result = (applyChange as unknown as (c: SyncChange, o: Record<string, unknown>) => { status: string; skipReason?: string })(olderChange, { staleGuard: true, unseenImpactRecords: [] });
    expect(result).toMatchObject({ status: "skipped", skipReason: "stale_change_rejected" });
    expect(db.prepare("SELECT title FROM track_milestones WHERE id = ?").get("ms-1")).toMatchObject({ title: "newer" });
  });
});
