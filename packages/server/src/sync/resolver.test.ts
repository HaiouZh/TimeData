import type { SyncChange, Task, TaskCompletionOp, Track, TrackStatusOp, TrackStep } from "@timedata/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;
let applyChange: (
  change: SyncChange,
  options?: {
    staleGuard?: boolean;
    staleAgainst?: Array<{ tableName: SyncChange["tableName"]; recordId: string }>;
    staleServerTimestamps?: ReadonlyMap<string, string | null>;
    db?: Database.Database;
  },
) => {
  status: string;
  reason: string;
  skipReason?: string;
  serverUpdatedAt?: string;
  overriddenRecordIds?: string[];
};
let getChangesSinceSeq: (sinceSeq: number | null) => Array<{ tableName: string; recordId: string; action: string }>;

beforeEach(async () => {
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

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE quick_notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT,
      source_label TEXT,
      pinned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT,
      last_done_at TEXT,
      start_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      parent_id TEXT,
      completed_count INTEGER NOT NULL DEFAULT 0,
      weight INTEGER NOT NULL DEFAULT 0,
      rule_id TEXT,
      skipped INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'active',
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
      seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      edited_at TEXT
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
    CREATE TABLE IF NOT EXISTS health_heart_rate (id TEXT PRIMARY KEY, date TEXT NOT NULL, resting_heart_rate INTEGER, min_heart_rate INTEGER, max_heart_rate INTEGER, avg_heart_rate INTEGER, last_7_days_avg_resting_heart_rate INTEGER, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_hrv (id TEXT PRIMARY KEY, date TEXT NOT NULL, hrv_ms INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_sleep (id TEXT PRIMARY KEY, date TEXT NOT NULL, sleep_start TEXT NOT NULL, wake_time TEXT NOT NULL, adjustment_hours INTEGER NOT NULL DEFAULT 0, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_stress (id TEXT PRIMARY KEY, date TEXT NOT NULL, stress INTEGER NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, distance_km REAL, duration_seconds INTEGER, average_heart_rate INTEGER, average_cadence REAL, average_stride_m REAL, average_vertical_ratio_percent REAL, average_vertical_oscillation_cm REAL, average_ground_contact_ms INTEGER, type TEXT NOT NULL, city TEXT NOT NULL, sync_seq INTEGER, sync_tombstone INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_charts (id TEXT PRIMARY KEY, type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);


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
  ({ applyChange } = await import("./resolver.js"));
  ({ getChangesSinceSeq } = await import("./seq.js"));
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

function taskData(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    parentId: null,
    title: "任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    skipped: false,
    sortOrder: 0,
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    ...overrides,
  };
}

function taskChange(action: "create" | "update", data: Task, op?: TaskCompletionOp): SyncChange {
  return {
    tableName: "tasks",
    recordId: data.id,
    action,
    data,
    timestamp: data.updatedAt,
    ...(op ? { op } : {}),
  } as SyncChange;
}

function trackData(overrides: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    title: "轨道",
    status: "active",
    refs: [],
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    ...overrides,
  };
}

function trackStepData(overrides: Partial<TrackStep> = {}): TrackStep {
  return {
    id: "step-1",
    trackId: "track-1",
    source: "agent",
    content: "步骤",
    startedAt: "2026-07-04T00:00:00.000Z",
    endedAt: null,
    refs: [],
    tags: [],
    seq: 0,
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    ...overrides,
  };
}

function trackChange(action: "create" | "update", data: Track, op?: TrackStatusOp): SyncChange {
  return {
    tableName: "tracks",
    recordId: data.id,
    action,
    data,
    timestamp: data.updatedAt,
    ...(op ? { op } : {}),
  } as SyncChange;
}

function trackStepChange(action: "create" | "update", data: TrackStep): SyncChange {
  return {
    tableName: "track_steps",
    recordId: data.id,
    action,
    data,
    timestamp: data.updatedAt,
  } as SyncChange;
}

describe("applyChange", () => {
  it("does not create placeholder categories for entry sync", () => {
    const result = applyChange({
      tableName: "time_entries",
      recordId: "entry-missing-category",
      action: "create",
      data: {
        id: "entry-missing-category",
        categoryId: "missing-category",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        note: null,
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T09:00:00",
      },
      timestamp: "2026-05-08T09:00:00",
    });

    const category = db.prepare("SELECT id FROM categories WHERE id = ?").get("missing-category");
    const entry = db.prepare("SELECT id FROM time_entries WHERE id = ?").get("entry-missing-category");

    expect(result).toMatchObject({ status: "skipped", reason: "missing category", skipReason: "missing_category" });
    expect(category).toBeUndefined();
    expect(entry).toBeUndefined();
  });

  it("updates an existing entry even when the server timestamp is newer", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-1",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "server",
      "2026-05-08T09:00:00",
      "2026-05-08T12:00:00",
    );

    const result = applyChange({
      tableName: "time_entries",
      recordId: "entry-1",
      action: "update",
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:30:00",
        note: "local wins",
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "2026-05-08T10:30:00",
      },
      timestamp: "2026-05-08T10:30:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "updated entry" });
    expect(db.prepare("SELECT note, end_time FROM time_entries WHERE id = ?").get("entry-1")).toMatchObject(
      {
        note: "local wins",
        end_time: "2026-05-08T10:30:00",
      },
    );
  });

  it("assigns server time to updated_at instead of client change timestamp", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-1",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "server",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );

    // 模拟时钟漂移严重的客户端：change.timestamp 是很久以前。
    const timestamp = "2020-01-01T00:00:00.000Z";
    const before = new Date().toISOString();
    applyChange({
      tableName: "time_entries",
      recordId: "entry-1",
      action: "update",
      data: {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:30:00",
        note: "local wins",
        createdAt: "2026-05-08T09:00:00",
        updatedAt: "1970-01-01T00:00:00.000Z",
      },
      timestamp,
    });

    const row = db.prepare("SELECT updated_at FROM time_entries WHERE id = ?").get("entry-1") as { updated_at: string };
    expect(row.updated_at > timestamp).toBe(true);
    expect(row.updated_at >= before).toBe(true);
  });

  it("deletes overlapping remote entries before inserting a local entry", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "remote-overlap",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "remote",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );

    const result = applyChange({
      tableName: "time_entries",
      recordId: "local-entry",
      action: "create",
      data: {
        id: "local-entry",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00",
        endTime: "2026-05-08T10:30:00",
        note: "local",
        createdAt: "2026-05-08T09:30:00",
        updatedAt: "2026-05-08T09:30:00",
      },
      timestamp: "2026-05-08T09:30:00",
    });

    expect(result).toMatchObject({
      status: "applied",
      reason: "inserted entry",
      overriddenRecordIds: ["remote-overlap"],
    });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("remote-overlap")).toBeUndefined();
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("local-entry")).toMatchObject({
      id: "local-entry",
    });
  });

  it("records tombstone and seq for entries deleted by overlap resolution", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-1",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "remote-overlap",
      "cat-1",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "remote",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );

    const result = applyChange({
      tableName: "time_entries",
      recordId: "local-entry",
      action: "create",
      data: {
        id: "local-entry",
        categoryId: "cat-1",
        startTime: "2026-05-08T09:30:00",
        endTime: "2026-05-08T10:30:00",
        note: "local",
        createdAt: "2026-05-08T09:30:00",
        updatedAt: "2026-05-08T09:30:00",
      },
      timestamp: "2026-05-08T09:30:00",
    });

    expect(result).toMatchObject({ status: "applied", overriddenRecordIds: ["remote-overlap"] });
    expect(
      db
        .prepare("SELECT table_name, record_id, deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?")
        .get("time_entries", "remote-overlap"),
    ).toMatchObject({
      table_name: "time_entries",
      record_id: "remote-overlap",
    });
    expect(
      db
        .prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name = ? AND record_id = ?")
        .get("time_entries", "remote-overlap"),
    ).toMatchObject({
      table_name: "time_entries",
      record_id: "remote-overlap",
      action: "delete",
    });
  });

  it("records tombstone, seq, and overridden ids for entries deleted by category cascade", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "parent-cat",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("child-cat", "深度工作", "parent-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "parent-entry",
      "parent-cat",
      "2026-05-08T09:00:00",
      "2026-05-08T10:00:00",
      "parent",
      "2026-05-08T09:00:00",
      "2026-05-08T09:00:00",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "child-entry",
      "child-cat",
      "2026-05-08T10:00:00",
      "2026-05-08T11:00:00",
      "child",
      "2026-05-08T10:00:00",
      "2026-05-08T10:00:00",
    );

    const result = applyChange({
      tableName: "categories",
      recordId: "parent-cat",
      action: "delete",
      timestamp: "2026-05-08T12:00:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "deleted category" });
    expect(result.overriddenRecordIds).toEqual(expect.arrayContaining(["parent-entry", "child-entry"]));
    expect(result.overriddenRecordIds).toHaveLength(2);
    expect(db.prepare("SELECT id FROM time_entries WHERE id IN (?, ?)").all("parent-entry", "child-entry")).toEqual([]);
    expect(
      db
        .prepare(
          "SELECT table_name, record_id, deleted_at FROM sync_tombstones WHERE table_name = ? ORDER BY record_id",
        )
        .all("time_entries"),
    ).toMatchObject([
      { table_name: "time_entries", record_id: "child-entry" },
      { table_name: "time_entries", record_id: "parent-entry" },
    ]);
    expect(
      db
        .prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name = ? ORDER BY record_id")
        .all("time_entries"),
    ).toEqual([
      { table_name: "time_entries", record_id: "child-entry", action: "delete" },
      { table_name: "time_entries", record_id: "parent-entry", action: "delete" },
    ]);
  });

  it("records seq for every category deleted by category cascade", () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "parent-cat",
      "工作",
      "#4A90D9",
      "2026-05-08T08:00:00",
      "2026-05-08T08:00:00",
    );
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("child-cat", "深度工作", "parent-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("grandchild-cat", "写作", "child-cat", "#4A90D9", "2026-05-08T08:00:00", "2026-05-08T08:00:00");

    const baseSeq = db.prepare("SELECT MAX(id) AS max_id FROM sync_seq").get() as { max_id: number | null };

    const result = applyChange({
      tableName: "categories",
      recordId: "parent-cat",
      action: "delete",
      timestamp: "2026-05-08T12:00:00",
    });

    expect(result).toMatchObject({ status: "applied", reason: "deleted category" });
    expect(
      db.prepare("SELECT id FROM categories WHERE id IN (?, ?, ?)").all("parent-cat", "child-cat", "grandchild-cat"),
    ).toEqual([]);
    expect(getChangesSinceSeq(baseSeq.max_id)).toEqual([
      { id: expect.any(Number), tableName: "categories", recordId: "parent-cat", action: "delete" },
      { id: expect.any(Number), tableName: "categories", recordId: "grandchild-cat", action: "delete" },
      { id: expect.any(Number), tableName: "categories", recordId: "child-cat", action: "delete" },
    ]);
  });

  it("records seq on successful category create", () => {
    const result = applyChange({
      tableName: "categories",
      recordId: "test-cat-seq",
      action: "create",
      data: {
        id: "test-cat-seq",
        name: "Seq Test",
        parentId: null,
        color: "#000",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const seq = db.prepare("SELECT table_name, record_id, action FROM sync_seq").get();
    expect(result).toMatchObject({ status: "applied" });
    expect(seq).toMatchObject({ table_name: "categories", record_id: "test-cat-seq", action: "create" });
  });

  it("applies settings upsert and delete", () => {
    const up = applyChange({
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "update",
      data: { key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" },
      timestamp: "2026-05-30T01:00:00.000Z",
    });

    expect(up.status).toBe("applied");
    expect(db.prepare("SELECT value FROM settings WHERE key = ?").get("sleep.categoryId")).toMatchObject({
      value: "cat-1",
    });

    const del = applyChange({
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "delete",
      data: null,
      timestamp: "2026-05-30T02:00:00.000Z",
    });

    expect(del.status).toBe("applied");
    expect(db.prepare("SELECT key FROM settings WHERE key = ?").get("sleep.categoryId")).toBeUndefined();
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'settings' AND record_id = ?").get("sleep.categoryId"),
    ).toBeDefined();
  });

  it("applies quick note upsert and delete without category dependencies", () => {
    const up = applyChange({
      tableName: "quick_notes",
      recordId: "note-1",
      action: "create",
      data: {
        id: "note-1",
        text: "repo",
        occurredAt: "2026-06-01T04:01:30.123Z",
        createdAt: "2026-06-01T04:02:00.000Z",
        updatedAt: "2026-06-01T04:02:00.000Z",
      },
      timestamp: "2026-06-01T04:02:00.000Z",
    });

    expect(up.status).toBe("applied");
    expect(db.prepare("SELECT text, occurred_at, updated_at FROM quick_notes WHERE id = ?").get("note-1")).toMatchObject({
      text: "repo",
      occurred_at: "2026-06-01T04:01:30.123Z",
      // updated_at 由服务器分配，只验证为合法 UTC ISO 格式。
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });

    const del = applyChange({
      tableName: "quick_notes",
      recordId: "note-1",
      action: "delete",
      data: null,
      timestamp: "2026-06-01T04:03:00.000Z",
    });

    expect(del.status).toBe("applied");
    expect(db.prepare("SELECT id FROM quick_notes WHERE id = ?").get("note-1")).toBeUndefined();
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = 'quick_notes' AND record_id = ?").get("note-1"),
    ).toBeDefined();
  });

  it("persists quick note source metadata on upsert", () => {
    const result = applyChange({
      tableName: "quick_notes",
      recordId: "note-agent",
      action: "create",
      data: {
        id: "note-agent",
        text: "周报已生成",
        occurredAt: "2026-06-03T01:00:00.000Z",
        createdAt: "2026-06-03T01:00:00.000Z",
        updatedAt: "2026-06-03T01:00:00.000Z",
        source: "agent",
        sourceLabel: "Hermes",
      },
      timestamp: "2026-06-03T01:00:00.000Z",
    });

    expect(result.status).toBe("applied");
    expect(db.prepare("SELECT source, source_label FROM quick_notes WHERE id = ?").get("note-agent")).toMatchObject({
      source: "agent",
      source_label: "Hermes",
    });
  });

  it("persists quick note pinned state on upsert", () => {
    const result = applyChange({
      tableName: "quick_notes",
      recordId: "note-pin",
      action: "create",
      data: {
        id: "note-pin",
        text: "重要",
        occurredAt: "2026-06-03T01:00:00.000Z",
        createdAt: "2026-06-03T01:00:00.000Z",
        updatedAt: "2026-06-03T01:00:00.000Z",
        pinned: true,
      },
      timestamp: "2026-06-03T01:00:00.000Z",
    });

    expect(result.status).toBe("applied");
    expect(db.prepare("SELECT pinned FROM quick_notes WHERE id = ?").get("note-pin")).toMatchObject({
      pinned: 1,
    });

    applyChange({
      tableName: "quick_notes",
      recordId: "note-pin",
      action: "update",
      data: {
        id: "note-pin",
        text: "重要",
        occurredAt: "2026-06-03T01:00:00.000Z",
        createdAt: "2026-06-03T01:00:00.000Z",
        updatedAt: "2026-06-03T02:00:00.000Z",
        pinned: false,
      },
      timestamp: "2026-06-03T02:00:00.000Z",
    });

    expect(db.prepare("SELECT pinned FROM quick_notes WHERE id = ?").get("note-pin")).toMatchObject({
      pinned: 0,
    });
  });

  describe("tasks 完成语义守卫列", () => {
    it("无 op 的 update 不覆盖 done/completed_at/skipped，其余列照常覆盖", () => {
      applyChange(taskChange("create", taskData()));
      applyChange(
        taskChange(
          "update",
          taskData({ done: true, completedAt: "2026-07-04T01:00:00.000Z", updatedAt: "2026-07-04T01:00:00.000Z" }),
          { type: "complete", at: "2026-07-04T01:00:00.000Z" },
        ),
      );

      const result = applyChange(taskChange("update", taskData({ title: "改了标题", updatedAt: "2026-07-04T02:00:00.000Z" })));

      expect(result.status).toBe("applied");
      const row = db.prepare("SELECT title, done, completed_at FROM tasks WHERE id = ?").get("task-1") as
        | { title: string; done: number; completed_at: string | null }
        | undefined;
      expect(row).toMatchObject({
        title: "改了标题",
        done: 1,
        completed_at: "2026-07-04T01:00:00.000Z",
      });
    });

    it("带 op 的 update 可以写完成字段", () => {
      applyChange(taskChange("create", taskData()));
      applyChange(
        taskChange(
          "update",
          taskData({ done: true, completedAt: "2026-07-04T01:00:00.000Z", updatedAt: "2026-07-04T01:00:00.000Z" }),
          { type: "complete", at: "2026-07-04T01:00:00.000Z" },
        ),
      );
      applyChange(
        taskChange("update", taskData({ updatedAt: "2026-07-04T02:00:00.000Z" }), {
          type: "reopen",
          at: "2026-07-04T02:00:00.000Z",
        }),
      );

      expect(db.prepare("SELECT done, completed_at FROM tasks WHERE id = ?").get("task-1")).toMatchObject({
        done: 0,
        completed_at: null,
      });
    });

    it("无 op 的 create 撞现存行同样不写完成字段", () => {
      applyChange(
        taskChange(
          "update",
          taskData({ done: true, completedAt: "2026-07-04T01:00:00.000Z", updatedAt: "2026-07-04T01:00:00.000Z" }),
          { type: "complete", at: "2026-07-04T01:00:00.000Z" },
        ),
      );
      applyChange(taskChange("create", taskData({ title: "重放的旧 create", updatedAt: "2026-07-04T02:00:00.000Z" })));

      expect(db.prepare("SELECT done, title FROM tasks WHERE id = ?").get("task-1")).toMatchObject({
        done: 1,
        title: "重放的旧 create",
      });
    });

    it("带 op 的 create 撞现存行可写完成字段", () => {
      applyChange(taskChange("create", taskData()));
      applyChange(
        taskChange(
          "create",
          taskData({ done: true, completedAt: "2026-07-04T01:00:00.000Z", updatedAt: "2026-07-04T01:00:00.000Z" }),
          { type: "complete", at: "2026-07-04T01:00:00.000Z" },
        ),
      );

      expect(db.prepare("SELECT done FROM tasks WHERE id = ?").get("task-1")).toMatchObject({ done: 1 });
    });

    it("行不存在时无 op 的 create 全列写入", () => {
      applyChange(taskChange("create", taskData({ skipped: true })));

      expect(db.prepare("SELECT skipped FROM tasks WHERE id = ?").get("task-1")).toMatchObject({ skipped: 1 });
    });
  });

  describe("tracks status 守卫列", () => {
    it("无 op 的 tracks update 不覆盖 status，其余列照常覆盖", () => {
      applyChange(trackChange("create", trackData()));
      applyChange(
        trackChange(
          "update",
          trackData({ status: "concluded", updatedAt: "2026-07-04T01:00:00.000Z" }),
          { type: "status", at: "2026-07-04T01:00:00.000Z" },
        ),
      );

      const result = applyChange(trackChange("update", trackData({ title: "改了标题", updatedAt: "2026-07-04T02:00:00.000Z" })));

      expect(result.status).toBe("applied");
      expect(db.prepare("SELECT title, status FROM tracks WHERE id = ?").get("track-1")).toMatchObject({
        title: "改了标题",
        status: "concluded",
      });
    });

    it("带 op 的 tracks update 可以写 status", () => {
      applyChange(trackChange("create", trackData()));
      applyChange(
        trackChange(
          "update",
          trackData({ status: "concluded", updatedAt: "2026-07-04T01:00:00.000Z" }),
          { type: "status", at: "2026-07-04T01:00:00.000Z" },
        ),
      );

      expect(db.prepare("SELECT status FROM tracks WHERE id = ?").get("track-1")).toMatchObject({
        status: "concluded",
      });
    });

    it("行不存在时无 op 的 create 全列写入", () => {
      applyChange(trackChange("create", trackData({ status: "parked" })));

      expect(db.prepare("SELECT status FROM tracks WHERE id = ?").get("track-1")).toMatchObject({ status: "parked" });
    });
  });

  describe("track_steps 宿主轨道闸", () => {
    it("宿主轨道不存在时 step create 被拒收 orphan_step_rejected", () => {
      const result = applyChange(trackStepChange("create", trackStepData({ trackId: "ghost" })));

      expect(result).toMatchObject({ status: "skipped", skipReason: "orphan_step_rejected" });
      expect(db.prepare("SELECT id FROM track_steps WHERE id = ?").get("step-1")).toBeUndefined();
    });

    it("宿主已删时 step update 同样被拒", () => {
      applyChange(trackChange("create", trackData()));
      applyChange(trackStepChange("create", trackStepData()));
      applyChange({ tableName: "tracks", recordId: "track-1", action: "delete", data: null, timestamp: "2026-07-04T01:00:00.000Z" } as SyncChange);

      const result = applyChange(trackStepChange("update", trackStepData({ updatedAt: "2026-07-04T02:00:00.000Z" })));

      expect(result).toMatchObject({ status: "skipped", skipReason: "orphan_step_rejected" });
    });

    it("宿主存在时 step create 正常 applied", () => {
      applyChange(trackChange("create", trackData()));

      const result = applyChange(trackStepChange("create", trackStepData()));

      expect(result.status).toBe("applied");
      expect(db.prepare("SELECT track_id FROM track_steps WHERE id = ?").get("step-1")).toMatchObject({
        track_id: "track-1",
      });
    });
  });

  describe("staleGuard", () => {
    function settingChange(value: string, timestamp: string): SyncChange {
      return {
        tableName: "settings",
        recordId: "theme",
        action: "update",
        data: { key: "theme", value, updatedAt: timestamp },
        timestamp,
      } as SyncChange;
    }

    it("rejects an update older than the current server row", () => {
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "theme",
        "dark",
        "2026-07-04T10:00:00.000Z",
      );

      const result = applyChange(settingChange("light", "2026-07-04T09:00:00.000Z"), { staleGuard: true });

      expect(result).toMatchObject({ status: "skipped", skipReason: "stale_change_rejected" });
      expect(result.serverUpdatedAt).toBe("2026-07-04T10:00:00.000Z");
      expect(db.prepare("SELECT value FROM settings WHERE key = ?").get("theme")).toMatchObject({ value: "dark" });
    });

    it("rejects an update with the same timestamp to prevent replay", () => {
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "theme",
        "dark",
        "2026-07-04T10:00:00.000Z",
      );

      const result = applyChange(settingChange("light", "2026-07-04T10:00:00.000Z"), { staleGuard: true });

      expect(result).toMatchObject({ status: "skipped", skipReason: "stale_change_rejected" });
    });

    it("applies an update newer than the current server row", () => {
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "theme",
        "dark",
        "2026-07-04T10:00:00.000Z",
      );

      const result = applyChange(settingChange("light", "2026-07-04T11:00:00.000Z"), { staleGuard: true });

      expect(result.status).toBe("applied");
      expect(db.prepare("SELECT value FROM settings WHERE key = ?").get("theme")).toMatchObject({ value: "light" });
    });

    it("rejects an update older than a tombstone and does not resurrect the row", () => {
      db.prepare("INSERT INTO sync_tombstones (table_name, record_id, deleted_at) VALUES (?, ?, ?)").run(
        "settings",
        "theme",
        "2026-07-04T10:00:00.000Z",
      );

      const result = applyChange(settingChange("light", "2026-07-04T09:00:00.000Z"), { staleGuard: true });

      expect(result).toMatchObject({ status: "skipped", skipReason: "stale_change_rejected" });
      expect(
        db.prepare("SELECT 1 FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get("settings", "theme"),
      ).toBeTruthy();
      expect(db.prepare("SELECT 1 FROM settings WHERE key = ?").get("theme")).toBeUndefined();
    });

    it("rejects a delete older than the current server row", () => {
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "theme",
        "dark",
        "2026-07-04T10:00:00.000Z",
      );

      const result = applyChange(
        { tableName: "settings", recordId: "theme", action: "delete", data: null, timestamp: "2026-07-04T09:00:00.000Z" } as SyncChange,
        { staleGuard: true },
      );

      expect(result).toMatchObject({ status: "skipped", skipReason: "stale_change_rejected" });
      expect(db.prepare("SELECT 1 FROM settings WHERE key = ?").get("theme")).toBeTruthy();
    });

    it("rejects an old incoming entry when an overlap deletion target is newer", () => {
      db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
        "cat-1",
        "工作",
        "#4A90D9",
        "2026-07-04T00:00:00.000Z",
        "2026-07-04T00:00:00.000Z",
      );
      db.prepare(`
        INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "remote-overlap",
        "cat-1",
        "2026-07-04T09:00:00.000Z",
        "2026-07-04T10:00:00.000Z",
        "server newer",
        "2026-07-04T09:00:00.000Z",
        "2026-07-04T12:00:00.000Z",
      );

      const result = applyChange(
        {
          tableName: "time_entries",
          recordId: "incoming",
          action: "create",
          data: {
            id: "incoming",
            categoryId: "cat-1",
            startTime: "2026-07-04T09:30:00.000Z",
            endTime: "2026-07-04T10:30:00.000Z",
            note: "old incoming",
            createdAt: "2026-07-04T09:30:00.000Z",
            updatedAt: "2026-07-04T10:00:00.000Z",
          },
          timestamp: "2026-07-04T10:00:00.000Z",
        } as SyncChange,
        {
          staleGuard: true,
          staleAgainst: [{ tableName: "time_entries", recordId: "remote-overlap" }],
        },
      );

      expect(result).toMatchObject({
        status: "skipped",
        skipReason: "stale_change_rejected",
        serverUpdatedAt: "2026-07-04T12:00:00.000Z",
      });
      expect(db.prepare("SELECT note FROM time_entries WHERE id = ?").get("remote-overlap")).toEqual({
        note: "server newer",
      });
      expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("incoming")).toBeUndefined();
      expect(db.prepare("SELECT * FROM sync_tombstones").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM sync_seq").all()).toEqual([]);
    });

    it("allows the guard when the target has neither row nor tombstone", () => {
      const result = applyChange(
        { tableName: "settings", recordId: "theme", action: "delete", data: null, timestamp: "2026-07-04T09:00:00.000Z" } as SyncChange,
        { staleGuard: true },
      );

      expect(result.status).toBe("applied");
    });

    it("keeps legacy behavior when staleGuard is not enabled", () => {
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "theme",
        "dark",
        "2026-07-04T10:00:00.000Z",
      );

      const result = applyChange(settingChange("light", "2026-07-04T09:00:00.000Z"));

      expect(result.status).toBe("applied");
      expect(db.prepare("SELECT value FROM settings WHERE key = ?").get("theme")).toMatchObject({ value: "light" });
    });
  });
});
