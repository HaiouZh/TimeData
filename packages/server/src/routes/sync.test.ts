import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncChange, Task, TaskCompletionOp } from "@timedata/shared";
import { createEntryFromCliInput } from "../lib/entry-service.js";
import { computeAndPersistCommitHash, getCommitHash } from "../sync/state.js";
let db: Database.Database;
let app: Hono;
let createServerBackupMock: ReturnType<typeof vi.fn>;
let markServerBackupProtectedMock: ReturnType<typeof vi.fn>;
const legacyTaskStateField = "tu" + "rn";
const legacyTaskStateTimeField = `${legacyTaskStateField}At`;

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

    CREATE TABLE sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      device TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      record_count INTEGER DEFAULT 0
    );

    CREATE TABLE sync_tombstones (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    );

    CREATE TABLE sync_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sync_push_requests (
      request_id TEXT PRIMARY KEY,
      status_code INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
    CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, status TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS track_steps (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, source TEXT NOT NULL, source_label TEXT, content TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, refs TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]', seq INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, edited_at TEXT);
    CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, note TEXT, members TEXT NOT NULL DEFAULT '[]', prerequisites TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS goal_layout_pins (goal_id TEXT NOT NULL, node_kind TEXT NOT NULL, node_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (goal_id, node_kind, node_id));
    CREATE TABLE IF NOT EXISTS deleted_tasks_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      delete_reason TEXT NOT NULL DEFAULT 'unknown',
      deleted_at TEXT NOT NULL
    );

  `);
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema();
  db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "cat-1",
    "工作",
    "#4A90D9",
    "2026-05-08T08:00:00.000Z",
    "2026-05-08T08:00:00.000Z",
  );

  vi.resetModules();
  createServerBackupMock = vi.fn(async (operation: string) => ({
    id: operation === "sync_local_wins" ? "sync_local_wins-backup-1" : "backup-1",
    path: "backup.db",
    createdAt: "2026-05-08T09:00:00.000Z",
    operation,
  }));
  markServerBackupProtectedMock = vi.fn();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db, getDbPath: () => ":memory:" }));
  vi.doMock("../sync/backup.js", () => ({
    createServerBackup: createServerBackupMock,
    markServerBackupProtected: markServerBackupProtectedMock,
  }));
  const syncRoute = (await import("./sync.js")).default;
  app = new Hono().route("/api/sync", syncRoute);
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
  vi.doUnmock("../sync/backup.js");
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

function taskDeleteChange(recordId: string, timestamp: string, deleteReason?: string): SyncChange {
  return {
    tableName: "tasks",
    recordId,
    action: "delete",
    data: null,
    timestamp,
    ...(deleteReason ? { deleteReason } : {}),
  } as SyncChange;
}

function latestSeq(): number {
  const row = db.prepare("SELECT MAX(id) AS seq FROM sync_seq").get() as { seq: number | null };
  return row.seq ?? 0;
}

function pushChanges(
  changes: SyncChange[],
  baseSeq: number | null = latestSeq(),
  requestId?: string,
): Promise<Response> {
  return app.request("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // requestId 省略时 JSON.stringify 会丢弃该键，天然覆盖"不带 requestId"的旧路径。
    body: JSON.stringify({ baseSeq, changes, requestId }),
  });
}

describe("sync route", () => {
  it("returns 400 for malformed sync pull requests", async () => {
    const response = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ sinceSeq: "not-a-number" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("rejects pull without sinceSeq (timestamp cursor retired)", async () => {
    const response = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ since: "2026-01-01T00:00:00.000Z" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("accepts sinceSeq 0 as full pull", async () => {
    const response = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it("records timings in pull_returned detail without changing response shape", async () => {
    const response = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    // 响应体总带分页字段（nextSinceSeq/hasMore）。
    expect(Object.keys(body).sort()).toEqual(["changes", "hasMore", "latestSeq", "nextSinceSeq", "serverTime"].sort());

    const logRow = db
      .prepare("SELECT detail FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
      .get("pull_returned") as { detail: string };
    const detail = JSON.parse(logRow.detail);
    expect(Object.keys(detail)[0]).toBe("timings");
    expect(typeof detail.timings.readMs).toBe("number");
    expect(typeof detail.timings.totalMs).toBe("number");
    expect(detail.timings.readMs).toBeGreaterThanOrEqual(0);
    expect(detail.timings.totalMs).toBeGreaterThanOrEqual(0);
    // 既有字段仍在。
    expect(detail.sinceSeq).toBe(0);
    expect(detail.latestSeq === null || typeof detail.latestSeq === "number").toBe(true);
  });

  function pushCategoryCreate(id: string) {
    return app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 0,
        changes: [
          {
            tableName: "categories",
            recordId: id,
            action: "create",
            timestamp: "2026-05-13T00:00:00.000Z",
            data: {
              id,
              name: id,
              parentId: null,
              color: "#000000",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          },
        ],
      }),
    });
  }

  it("paginates pull with limit, advancing nextSinceSeq and hasMore", async () => {
    for (const id of ["c1", "c2", "c3"]) {
      const res = await pushCategoryCreate(id);
      expect(res.status).toBe(200);
    }

    const r1 = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0, limit: 2 }),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.changes).toHaveLength(2);
    expect(b1.hasMore).toBe(true);
    expect(b1.nextSinceSeq).toBe(2);

    const r2 = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: b1.nextSinceSeq, limit: 2 }),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.changes).toHaveLength(1);
    expect(b2.hasMore).toBe(false);
    expect(b2.nextSinceSeq).toBe(3);
  });

  it("pull without limit returns all changes with hasMore false", async () => {
    for (const id of ["c1", "c2"]) {
      const res = await pushCategoryCreate(id);
      expect(res.status).toBe(200);
    }

    const res = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasMore).toBe(false);
    expect(body.nextSinceSeq).toBe(body.latestSeq);
  });

  it("creates a protected manual server backup", async () => {
    const response = await app.request("/api/sync/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ backupId: "backup-1" });
    expect(createServerBackupMock).toHaveBeenCalledWith("manual", { protected: true, reason: "manual" });
  });

  it("returns 400 for malformed force-push prepare requests", async () => {
    const response = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ categoryCount: -1, entryCount: 0, lastUpdatedAt: null }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns server sync status counts and latest update", async () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-2",
      "学习",
      "#22c55e",
      "2026-05-08T12:00:00.000Z",
      "2026-05-08T12:30:00.000Z",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-1",
      "cat-1",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T10:00:00.000Z",
      null,
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T13:00:00.000Z",
    );

    const res = await app.request("/api/sync/status", { headers: { Authorization: "Bearer test-token" } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      categoryCount: 2,
      entryCount: 1,
      quickNoteCount: 0,
      lastUpdatedAt: "2026-05-08T13:00:00.000Z",
      latestSeq: null,
    });
    expect(typeof body.serverTime).toBe("string");
    expect(typeof body.contentHash).toBe("string");
  });

  it("returns /status contentHash from persisted sync_state", async () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-1",
      "cat-1",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T10:00:00.000Z",
      null,
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T11:00:00.000Z",
    );
    computeAndPersistCommitHash(db);
    const expected = getCommitHash(db);

    const res = await app.request("/api/sync/status", { headers: { Authorization: "Bearer test-token" } });
    const body = await res.json();

    expect(body.contentHash).toBe(expected.hash);
    expect(body.latestSeq).toBe(expected.latestSeq);
  });

  it("does not stringify full datasets when reading /status contentHash", async () => {
    computeAndPersistCommitHash(db);
    const stringifySpy = vi.spyOn(JSON, "stringify");

    await app.request("/api/sync/status", { headers: { Authorization: "Bearer test-token" } });

    expect(stringifySpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ categories: expect.any(Array), timeEntries: expect.any(Array) }),
    );
  });

  it("changes /status contentHash when record content changes without count changing after sync state refresh", async () => {
    computeAndPersistCommitHash(db);
    const before = await app.request("/api/sync/status", { headers: { Authorization: "Bearer test-token" } });
    const beforeBody = await before.json();

    db.prepare("UPDATE categories SET name = ?, updated_at = ? WHERE id = ?").run(
      "工作-改名",
      "2026-05-08T14:00:00.000Z",
      "cat-1",
    );
    computeAndPersistCommitHash(db);

    const after = await app.request("/api/sync/status", { headers: { Authorization: "Bearer test-token" } });
    const afterBody = await after.json();

    expect(afterBody.categoryCount).toBe(beforeBody.categoryCount);
    expect(beforeBody.contentHash).toBeDefined();
    expect(afterBody.contentHash).toBeDefined();
    expect(afterBody.contentHash).not.toBe(beforeBody.contentHash);
  });

  it("returns latest sync sequence in server sync status", async () => {
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "categories",
      "cat-1",
      "create",
    );
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "time_entries",
      "entry-1",
      "create",
    );

    const res = await app.request("/api/sync/status");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latestSeq).toBe(2);
  });

  it("opens a sync event stream with a hello frame", async () => {
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "categories",
      "cat-1",
      "create",
    );
    const controller = new AbortController();
    const res = await app.request("/api/sync/stream", { signal: controller.signal });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain("event: hello");
    expect(text).toContain('data: {"latestSeq":1}');

    controller.abort();
    await reader!.cancel().catch(() => undefined);
  });

  it("broadcasts a sync bump after a successful push commits", async () => {
    const { addSyncStreamListener, removeSyncStreamListener } = await import("../sync/notifier.js");
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);
    addSyncStreamListener(listener);

    try {
      const res = await app.request("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: [
            {
              tableName: "categories",
              recordId: "cat-stream",
              action: "create",
              data: {
                id: "cat-stream",
                name: "实时同步",
                parentId: null,
                color: "#22c55e",
                icon: null,
                sortOrder: 1,
                isArchived: false,
                createdAt: "2026-06-02T00:00:00.000Z",
                updatedAt: "2026-06-02T00:00:00.000Z",
              },
              timestamp: "2026-06-02T00:00:00.000Z",
            },
          ],
          baseSeq: null,
        }),
      });

      expect(res.status).toBe(200);
      expect(seen.at(-1)).toBe(1);
    } finally {
      removeSyncStreamListener(listener);
    }
  });

  it("creates a short-lived force-push confirmation token", async () => {
    const res = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryCount: 1,
        entryCount: 0,
        lastUpdatedAt: "2026-05-08T08:00:00.000Z",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.confirmToken).toBe("string");
    expect(body.confirmToken.length).toBeGreaterThan(20);
    expect(body.confirmationPhrase).toBe("OVERWRITE_SERVER");
    expect(typeof body.expiresAt).toBe("string");
    expect(body.serverStatus).toMatchObject({ categoryCount: 1, entryCount: 0, quickNoteCount: 0 });
  });

  it("records expired force-push tokens as rejected", async () => {
    vi.setSystemTime(new Date("2026-05-17T00:00:00.000Z"));
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, lastUpdatedAt: null }),
    });
    const prepareBody = await prepareRes.json();

    vi.setSystemTime(new Date("2026-05-17T00:06:00.000Z"));
    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
      }),
    });

    expect(res.status).toBe(403);
    expect(
      db
        .prepare("SELECT action, detail FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
        .get("force_push_expired"),
    ).toMatchObject({
      action: "force_push_expired",
    });
  });

  it("rejects reusing a force-push token", async () => {
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, lastUpdatedAt: null }),
    });
    const prepareBody = await prepareRes.json();

    const first = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
      }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
      }),
    });

    expect(second.status).toBe(403);
    const audit = db
      .prepare("SELECT action, detail FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
      .get("force_push_rejected") as { action: string; detail: string };
    expect(audit).toMatchObject({ action: "force_push_rejected" });
    expect(audit.detail).not.toContain(prepareBody.confirmToken);
  });

  it("backs up and replaces server data during confirmed force push", async () => {
    const oldCursor = Number(
      db
        .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
        .run("categories", "cat-1", "create").lastInsertRowid,
    );
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 2, entryCount: 1, lastUpdatedAt: "2026-05-08T15:00:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [
          {
            id: "cat-local-parent",
            name: "本地父分类",
            parentId: null,
            color: "#64748b",
            icon: null,
            sortOrder: 0,
            isArchived: false,
            createdAt: "2026-05-08T14:00:00.000Z",
            updatedAt: "2026-05-08T14:00:00.000Z",
          },
          {
            id: "cat-local-child",
            name: "本地子分类",
            parentId: "cat-local-parent",
            color: "#22c55e",
            icon: null,
            sortOrder: 1,
            isArchived: false,
            createdAt: "2026-05-08T14:00:00.000Z",
            updatedAt: "2026-05-08T14:00:00.000Z",
          },
        ],
        timeEntries: [
          {
            id: "entry-local",
            categoryId: "cat-local-child",
            startTime: "2026-05-08T15:00:00.000Z",
            endTime: "2026-05-08T16:00:00.000Z",
            note: "本地恢复后的记录",
            createdAt: "2026-05-08T15:00:00.000Z",
            updatedAt: "2026-05-08T15:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      importedCategories: 2,
      importedTimeEntries: 1,
      backupId: "backup-1",
      latestSeq: oldCursor + 4,
    });
    expect(createServerBackupMock).toHaveBeenCalledWith(
      "sync_force_push",
      expect.objectContaining({
        protected: true,
        reason: "force_push_overwrite",
      }),
    );
    expect(markServerBackupProtectedMock).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) as count FROM sync_seq").get()).toMatchObject({ count: oldCursor + 4 });
    expect(db.prepare("SELECT COUNT(*) as count FROM categories").get()).toMatchObject({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) as count FROM time_entries").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT name FROM categories WHERE id = ?").get("cat-1")).toBeUndefined();
    expect(
      db.prepare("SELECT action FROM sync_seq WHERE table_name = ? AND record_id = ? ORDER BY id DESC LIMIT 1").get(
        "categories",
        "cat-1",
      ),
    ).toEqual({ action: "delete" });
    expect(
      db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(
        "categories",
        "cat-1",
      ),
    ).toEqual({ deleted_at: expect.any(String) });
    expect(db.prepare("SELECT note FROM time_entries WHERE id = ?").get("entry-local")).toMatchObject({
      note: "本地恢复后的记录",
    });
    expect(db.prepare("SELECT action FROM sync_logs WHERE action = ?").get("force_push_applied")).toMatchObject({
      action: "force_push_applied",
    });

    const pullRes = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: oldCursor }),
    });
    expect(pullRes.status).toBe(200);
    const pullBody = await pullRes.json();
    expect(pullBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: "categories",
          recordId: "cat-1",
          action: "delete",
          data: null,
        }),
      ]),
    );
  });

  it("force-push deleting a parent category relies on one cascade instead of duplicate child and entry deletes", async () => {
    const now = "2026-07-10T00:00:00.000Z";
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("force-parent", "父分类", null, "#64748b", null, 0, 0, now, now);
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("force-child", "子分类", "force-parent", "#22c55e", null, 0, 0, now, now);
    db.prepare(
      "INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "force-child-entry",
      "force-child",
      "2026-07-10T01:00:00.000Z",
      "2026-07-10T02:00:00.000Z",
      null,
      now,
      now,
    );
    const oldCursor = latestSeq();

    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, quickNoteCount: 0, lastUpdatedAt: null }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
        quickNotes: [],
        tasks: [],
      }),
    });

    expect(res.status).toBe(200);
    expect(
      db
        .prepare(
          "SELECT table_name, record_id, action FROM sync_seq WHERE id > ? AND record_id IN (?, ?, ?) ORDER BY id",
        )
        .all(oldCursor, "force-parent", "force-child", "force-child-entry"),
    ).toEqual([
      { table_name: "categories", record_id: "force-parent", action: "delete" },
      { table_name: "time_entries", record_id: "force-child-entry", action: "delete" },
      { table_name: "categories", record_id: "force-child", action: "delete" },
    ]);
  });

  it("preserves non-covered rows, seq, and tombstones during confirmed force push", async () => {
    const recordId = "goal-1|goal|goal-1";
    db.prepare(
      "INSERT INTO goal_layout_pins (goal_id, node_kind, node_id, x, y, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("goal-1", "goal", "goal-1", 100, 200, "2026-06-24T00:00:00.000Z");
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "goal_layout_pins",
      recordId,
      "create",
    );
    db.prepare("INSERT INTO sync_tombstones (table_name, record_id, deleted_at) VALUES (?, ?, ?)").run(
      "goals",
      "goal-deleted",
      "2026-06-24T00:05:00.000Z",
    );
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "goals",
      "goal-deleted",
      "delete",
    );
    const oldLatestSeq = latestSeq();

    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, lastUpdatedAt: null }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
      }),
    });

    expect(res.status).toBe(200);
    expect(db.prepare("SELECT x, y FROM goal_layout_pins WHERE goal_id = ?").get("goal-1")).toEqual({
      x: 100,
      y: 200,
    });
    expect(
      db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(
        "goals",
        "goal-deleted",
      ),
    ).toEqual({ deleted_at: "2026-06-24T00:05:00.000Z" });
    expect(
      db.prepare("SELECT action FROM sync_seq WHERE table_name = ? AND record_id = ? ORDER BY id").all(
        "goal_layout_pins",
        recordId,
      ),
    ).toEqual([{ action: "create" }]);
    expect(
      db.prepare("SELECT action FROM sync_seq WHERE table_name = ? AND record_id = ? ORDER BY id").all(
        "goals",
        "goal-deleted",
      ),
    ).toEqual([{ action: "delete" }]);
    expect(latestSeq()).toBeGreaterThan(oldLatestSeq);
  });

  it("force-push imports settings when provided and reports their count", async () => {
    const seqBefore = latestSeq();
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, lastUpdatedAt: "2026-05-30T00:00:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
        settings: [{ key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      importedCategories: 0,
      importedTimeEntries: 0,
      importedSettings: 1,
      latestSeq: seqBefore + 2,
    });
    expect(db.prepare("SELECT value, updated_at FROM settings WHERE key = ?").get("sleep.categoryId")).toMatchObject({
      value: "cat-1",
      updated_at: expect.any(String),
    });
  });

  it("force-push imports quick notes independently from categories and entries", async () => {
    const seqBefore = latestSeq();
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, quickNoteCount: 1, lastUpdatedAt: "2026-06-01T04:02:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
        quickNotes: [
          {
            id: "note-force",
            text: "repo",
            occurredAt: "2026-06-01T04:01:30.123Z",
            createdAt: "2026-06-01T04:02:00.000Z",
            updatedAt: "2026-06-01T04:02:00.000Z",
            source: "agent",
            sourceLabel: "Hermes",
            pinned: true,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      importedCategories: 0,
      importedTimeEntries: 0,
      importedQuickNotes: 1,
      latestSeq: seqBefore + 2,
    });
    expect(db.prepare("SELECT text, occurred_at, source, source_label, pinned FROM quick_notes WHERE id = ?").get("note-force")).toMatchObject({
      text: "repo",
      occurred_at: "2026-06-01T04:01:30.123Z",
      source: "agent",
      source_label: "Hermes",
      pinned: 1,
    });
  });

  it("force-push imports tasks independently from categories and entries", async () => {
    const seqBefore = latestSeq();
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, quickNoteCount: 0, lastUpdatedAt: "2026-06-14T00:00:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
        tasks: [
          {
            id: "task-force",
            parentId: null,
            title: "跑步",
            done: false,
            recurrence: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" },
            lastDoneAt: null,
            startAt: "2026-06-14T00:00:00.000Z",
            scheduledAt: "2026-06-16T00:00:00.000Z",
            sortOrder: 0,
            completedCount: 2,
            weight: 3,
            [legacyTaskStateField]: "running",
            [legacyTaskStateTimeField]: "2026-06-16T01:00:00.000Z",
            completedAt: "2026-06-16T02:00:00.000Z",
            tags: ["agent", "idea"],
            createdAt: "2026-06-14T00:00:00.000Z",
            updatedAt: "2026-06-14T00:00:00.000Z",
          },
          {
            id: "task-force-child",
            parentId: "task-force",
            title: "验收子任务",
            done: false,
            recurrence: null,
            lastDoneAt: null,
            startAt: null,
            scheduledAt: null,
            sortOrder: 0,
            completedCount: 0,
            weight: 0,
            completedAt: null,
            tags: [],
            createdAt: "2026-06-14T00:00:00.000Z",
            updatedAt: "2026-06-14T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      importedCategories: 0,
      importedTimeEntries: 0,
      importedQuickNotes: 0,
      importedTasks: 2,
      latestSeq: seqBefore + 3,
    });
    expect(
      db
        .prepare("SELECT title, recurrence, start_at, scheduled_at, parent_id, completed_count, weight, completed_at, tags FROM tasks WHERE id = ?")
        .get("task-force"),
    ).toMatchObject({
      title: "跑步",
      recurrence: JSON.stringify({ freq: "weekly", interval: 1, byWeekday: [1], basis: "due" }),
      start_at: "2026-06-14T00:00:00.000Z",
      scheduled_at: "2026-06-16T00:00:00.000Z",
      parent_id: null,
      completed_count: 2,
      weight: 3,
      completed_at: "2026-06-16T02:00:00.000Z",
      tags: JSON.stringify(["agent", "idea"]),
    });
    expect(db.prepare("SELECT parent_id FROM tasks WHERE id = ?").get("task-force-child")).toMatchObject({
      parent_id: "task-force",
    });
    expect(
      db.prepare("SELECT action FROM sync_seq WHERE table_name = ? AND record_id = ?").get("tasks", "task-force"),
    ).toEqual({ action: "create" });
  });

  it("force-push imports task ruleId/skipped fields", async () => {
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 0, quickNoteCount: 0, lastUpdatedAt: "2026-06-30T00:00:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
        quickNotes: [],
        tasks: [
          {
            id: "occ-1",
            parentId: null,
            title: "补铁",
            done: false,
            recurrence: null,
            lastDoneAt: null,
            startAt: null,
            scheduledAt: "2026-06-30T00:00:00.000Z",
            completedCount: 0,
            weight: 0,
            completedAt: null,
            tags: [],
            ruleId: "rule-iron",
            skipped: true,
            sortOrder: 0,
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(db.prepare("SELECT rule_id, skipped FROM tasks WHERE id = ?").get("occ-1")).toEqual({
      rule_id: "rule-iron",
      skipped: 1,
    });

    const pullRes = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });
    const pullBody = await pullRes.json();
    expect(pullBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: "tasks",
          recordId: "occ-1",
          data: expect.objectContaining({ ruleId: "rule-iron", skipped: true }),
        }),
      ]),
    );
  });

  it("rejects force push without a valid confirmation token", async () => {
    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: "not-a-valid-token",
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [],
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toBe("Invalid or expired force-push confirmation token.");
  });

  it("rejects force push when entries reference missing categories", async () => {
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 0, entryCount: 1, lastUpdatedAt: "2026-05-08T15:00:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [],
        timeEntries: [
          {
            id: "entry-orphan",
            categoryId: "missing-cat",
            startTime: "2026-05-08T15:00:00.000Z",
            endTime: "2026-05-08T16:00:00.000Z",
            note: null,
            createdAt: "2026-05-08T15:00:00.000Z",
            updatedAt: "2026-05-08T15:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_BODY");
    expect(body.error.message).toContain("missing category");
    expect(db.prepare("SELECT COUNT(*) as count FROM categories").get()).toMatchObject({ count: 1 });
  });

  it("rejects force push categories that reference themselves", async () => {
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 1, entryCount: 0, lastUpdatedAt: "2026-05-08T15:00:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [
          {
            id: "cat-self",
            name: "自引用",
            parentId: "cat-self",
            color: "#64748b",
            icon: null,
            sortOrder: 0,
            isArchived: false,
            createdAt: "2026-05-08T14:00:00.000Z",
            updatedAt: "2026-05-08T14:00:00.000Z",
          },
        ],
        timeEntries: [],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_BODY");
    expect(body.error.message).toContain("references itself");
    expect(db.prepare("SELECT COUNT(*) as count FROM categories").get()).toMatchObject({ count: 1 });
  });

  it("rejects force push categories that would create a third level", async () => {
    const prepareRes = await app.request("/api/sync/force-push/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryCount: 3, entryCount: 0, lastUpdatedAt: "2026-05-08T15:00:00.000Z" }),
    });
    const prepareBody = await prepareRes.json();

    const res = await app.request("/api/sync/force-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmToken: prepareBody.confirmToken,
        confirmationPhrase: "OVERWRITE_SERVER",
        categories: [
          {
            id: "cat-parent",
            name: "父分类",
            parentId: null,
            color: "#64748b",
            icon: null,
            sortOrder: 0,
            isArchived: false,
            createdAt: "2026-05-08T14:00:00.000Z",
            updatedAt: "2026-05-08T14:00:00.000Z",
          },
          {
            id: "cat-child",
            name: "子分类",
            parentId: "cat-parent",
            color: "#22c55e",
            icon: null,
            sortOrder: 1,
            isArchived: false,
            createdAt: "2026-05-08T14:00:00.000Z",
            updatedAt: "2026-05-08T14:00:00.000Z",
          },
          {
            id: "cat-grandchild",
            name: "三级分类",
            parentId: "cat-child",
            color: "#f97316",
            icon: null,
            sortOrder: 0,
            isArchived: false,
            createdAt: "2026-05-08T14:00:00.000Z",
            updatedAt: "2026-05-08T14:00:00.000Z",
          },
        ],
        timeEntries: [],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_BODY");
    expect(body.error.message).toContain("third level");
    expect(db.prepare("SELECT COUNT(*) as count FROM categories").get()).toMatchObject({ count: 1 });
  });

  it("records timings in push_rejected detail while keeping outcomes intact", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 0,
        changes: [
          {
            tableName: "time_entries",
            recordId: "entry-mismatch",
            action: "create",
            data: {
              id: "entry-different-id",
              categoryId: "cat-1",
              startTime: "2026-05-08T09:00:00.000Z",
              endTime: "2026-05-08T10:00:00.000Z",
              note: null,
              createdAt: "2026-05-08T09:00:00.000Z",
              updatedAt: "2026-05-08T09:00:00.000Z",
            },
            timestamp: "2026-05-08T09:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.rejected).toBe(1);
    expect(body.outcomes[0]).toMatchObject({ status: "rejected", reasonCode: "id_mismatch" });

    const logRow = db
      .prepare("SELECT detail FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
      .get("push_rejected") as { detail: string };
    const detail = JSON.parse(logRow.detail);
    expect(Object.keys(detail)[0]).toBe("timings");
    expect(typeof detail.timings.parseMs).toBe("number");
    expect(typeof detail.timings.validateMs).toBe("number");
    expect(detail.timings.parseMs).toBeGreaterThanOrEqual(0);
    expect(detail.timings.validateMs).toBeGreaterThanOrEqual(0);
    // 信息不丢：outcomes 仍然可从 detail 中还原。
    expect(detail.outcomes).toEqual(body.outcomes);
    // 本用例是该 db 首次 push（校验失败，从未记账），latestSeq 契约允许 null。
    expect(body.latestSeq).toBeNull();
    expect(body.appliedCount).toBe(0);
  });

  it("atomically rejects a mixed valid/invalid batch without applying accepted validation outcomes", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 0,
        changes: [
          {
            tableName: "quick_notes",
            recordId: "note-valid",
            action: "create",
            data: {
              id: "note-valid",
              text: "这条仅通过校验，整批拒绝时不能落库",
              occurredAt: "2026-05-08T01:00:00.000Z",
              createdAt: "2026-05-08T01:00:00.000Z",
              updatedAt: "2026-05-08T01:00:00.000Z",
              source: "user",
              pinned: false,
            },
            timestamp: "2026-05-08T01:00:00.000Z",
          },
          {
            tableName: "time_entries",
            recordId: "entry-invalid",
            action: "create",
            data: {
              id: "different-id",
              categoryId: "cat-1",
              startTime: "2026-05-08T02:00:00.000Z",
              endTime: "2026-05-08T03:00:00.000Z",
              note: null,
              createdAt: "2026-05-08T02:00:00.000Z",
              updatedAt: "2026-05-08T02:00:00.000Z",
            },
            timestamp: "2026-05-08T02:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 1, conflicts: 0, appliedCount: 0, latestSeq: null });
    expect(body.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordId: "note-valid",
          status: "accepted",
          reasonCode: "validated",
        }),
        expect.objectContaining({
          recordId: "entry-invalid",
          status: "rejected",
          reasonCode: "id_mismatch",
        }),
      ]),
    );
    expect(db.prepare("SELECT id FROM quick_notes WHERE id = ?").get("note-valid")).toBeUndefined();
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("entry-invalid")).toBeUndefined();
    expect(db.prepare("SELECT * FROM sync_seq").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM sync_tombstones").all()).toEqual([]);
  });

  it("returns latestSeq and appliedCount for accepted pushes", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 0,
        changes: [
          {
            tableName: "categories",
            recordId: "c1",
            action: "create",
            timestamp: "2026-05-13T00:00:00.000Z",
            data: {
              id: "c1",
              name: "A",
              parentId: null,
              color: "#000000",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(1);
    expect(typeof body.latestSeq).toBe("number");
    expect(body.appliedCount).toBe(1); // 一条 create → 记一次账
    expect(body.latestSeq).toBe(body.appliedCount); // baseSeq=0 全新库：latestSeq == appliedCount
  });

  it("push appliedCount reflects only this push's ledger delta", async () => {
    // 先推一条占用 seq（另一"设备"）
    await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 0,
        changes: [
          {
            tableName: "categories",
            recordId: "c1",
            action: "create",
            timestamp: "2026-05-13T00:00:00.000Z",
            data: {
              id: "c1",
              name: "A",
              parentId: null,
              color: "#000000",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          },
        ],
      }),
    });

    // 再推第二条，appliedCount 只应是 1（本批），latestSeq 是全局累计
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 1,
        changes: [
          {
            tableName: "categories",
            recordId: "c2",
            action: "create",
            timestamp: "2026-05-13T00:01:00.000Z",
            data: {
              id: "c2",
              name: "B",
              parentId: null,
              color: "#000000",
              icon: null,
              sortOrder: 1,
              isArchived: false,
              createdAt: "2026-05-13T00:01:00.000Z",
              updatedAt: "2026-05-13T00:01:00.000Z",
            },
          },
        ],
      }),
    });

    const body = await res.json();
    expect(body.appliedCount).toBe(1);
    expect(body.latestSeq).toBe(2);
  });

  it("creates a protected unknown-base backup when baseSeq is missing", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "categories",
            recordId: "cat-1",
            action: "update",
            data: {
              id: "cat-1",
              name: "工作",
              parentId: null,
              color: "#22c55e",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-08T08:00:00.000Z",
              updatedAt: "2026-05-08T09:00:00.000Z",
            },
            timestamp: "2026-05-08T09:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 0, conflicts: 0, backupId: "backup-1" });
    expect(createServerBackupMock).toHaveBeenCalledWith("sync_unknown_base", {
      protected: true,
      reason: "unknown_base",
      details: {
        baseSeq: null,
        cloudAheadCount: 0,
        overlappingRecords: [],
        pushedRecords: [{ tableName: "categories", recordId: "cat-1", action: "update" }],
      },
    });
    expect(markServerBackupProtectedMock).not.toHaveBeenCalled();
    const logRow = db
      .prepare("SELECT detail FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
      .get("push_received") as { detail: string };
    expect(JSON.parse(logRow.detail)).toMatchObject({
      protected: true,
      seqAnalysis: { strategy: "unknown_base", cloudAheadCount: 0, overlappingRecords: [] },
    });
  });

  it("returns per-change outcomes and a backup id for accepted pushes", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 0,
        changes: [
          {
            tableName: "time_entries",
            recordId: "entry-1",
            action: "create",
            data: {
              id: "entry-1",
              categoryId: "cat-1",
              startTime: "2026-05-08T09:00:00.000Z",
              endTime: "2026-05-08T10:00:00.000Z",
              note: null,
              createdAt: "2026-05-08T09:00:00.000Z",
              updatedAt: "2026-05-08T09:00:00.000Z",
            },
            timestamp: "2026-05-08T09:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 0, conflicts: 0, backupId: null });
    expect(body.outcomes[0]).toMatchObject({ status: "accepted", reasonCode: "applied", recordId: "entry-1" });
    expect(createServerBackupMock).not.toHaveBeenCalled();
    expect(markServerBackupProtectedMock).not.toHaveBeenCalled();
    // 响应体字段集不因新增计时埋点而变化（latestSeq/appliedCount 是本轮新增的既定契约字段）。
    expect(Object.keys(body).sort()).toEqual(
      ["accepted", "appliedCount", "backupId", "conflicts", "latestSeq", "outcomes", "rejected", "serverTime"].sort(),
    );

    const logRow = db
      .prepare("SELECT detail FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
      .get("push_received") as { detail: string };
    const detail = JSON.parse(logRow.detail);
    expect(detail.timings).toBeDefined();
    expect(typeof detail.timings.parseMs).toBe("number");
    expect(typeof detail.timings.validateMs).toBe("number");
    expect(typeof detail.timings.analyzeBackupMs).toBe("number");
    expect(typeof detail.timings.applyMs).toBe("number");
    expect(typeof detail.timings.totalMs).toBe("number");
    expect(detail.timings.parseMs).toBeGreaterThanOrEqual(0);
    expect(detail.timings.validateMs).toBeGreaterThanOrEqual(0);
    expect(detail.timings.analyzeBackupMs).toBeGreaterThanOrEqual(0);
    expect(detail.timings.applyMs).toBeGreaterThanOrEqual(0);
    expect(detail.timings.totalMs).toBeGreaterThanOrEqual(0);
    // 各分段是真实增量而非累计水位：分段之和不应明显超过 totalMs（各段独立 Math.round 可能有 ±1ms 累积误差）。
    const segmentSum =
      detail.timings.parseMs + detail.timings.validateMs + detail.timings.analyzeBackupMs + detail.timings.applyMs;
    expect(segmentSum).toBeLessThanOrEqual(detail.timings.totalMs + 4);
    // timings 必须是 detail 对象的第一个字段，避免被超长内容截断。
    expect(Object.keys(detail)[0]).toBe("timings");
  });

  it("creates a protected sync_overlap_delete backup when a push deletes overlapping entries", async () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-existing",
      "cat-1",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T10:00:00.000Z",
      null,
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T09:00:00.000Z",
    );

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq: 0,
        changes: [
          {
            tableName: "time_entries",
            recordId: "entry-overlap",
            action: "create",
            data: {
              id: "entry-overlap",
              categoryId: "cat-1",
              startTime: "2026-05-08T09:30:00.000Z",
              endTime: "2026-05-08T10:30:00.000Z",
              note: null,
              createdAt: "2026-05-08T09:30:00.000Z",
              updatedAt: "2026-05-08T09:30:00.000Z",
            },
            timestamp: "2026-05-08T09:30:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 0, conflicts: 0, backupId: "backup-1" });
    expect(createServerBackupMock).toHaveBeenCalledWith(
      "sync_overlap_delete",
      expect.objectContaining({
        protected: true,
        reason: "implicit_delete",
        details: expect.objectContaining({
          predictedDeletedRecordIds: ["entry-existing"],
          implicitImpactRecords: expect.arrayContaining([
            { tableName: "time_entries", recordId: "entry-existing" },
          ]),
        }),
      }),
    );
    expect(markServerBackupProtectedMock).not.toHaveBeenCalled();
  });

  it.each([
    ["子分类", "categories", "cat-child"],
    ["子分类下的记录", "time_entries", "entry-child"],
  ] as const)(
    "baseSeq 后%s更新时拒绝旧的父分类删除且保留整棵树",
    async (_label, updatedTable, updatedRecordId) => {
      db.prepare(
        "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        "cat-child",
        "子分类",
        "cat-1",
        "#22c55e",
        "2026-07-10T08:00:00.000Z",
        updatedTable === "categories" ? "2026-07-10T12:00:00.000Z" : "2026-07-10T08:00:00.000Z",
      );
      db.prepare(`
        INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "entry-child",
        "cat-child",
        "2026-07-10T09:00:00.000Z",
        "2026-07-10T10:00:00.000Z",
        "服务器上的新内容",
        "2026-07-10T09:00:00.000Z",
        updatedTable === "time_entries" ? "2026-07-10T12:00:00.000Z" : "2026-07-10T09:00:00.000Z",
      );
      const baseSeq = Number(
        db
          .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
          .run("categories", "cat-1", "create").lastInsertRowid,
      );
      const serverSeq = Number(
        db
          .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
          .run(updatedTable, updatedRecordId, "update").lastInsertRowid,
      );

      const res = await pushChanges(
        [
          {
            tableName: "categories",
            recordId: "cat-1",
            action: "delete",
            data: null,
            timestamp: "2026-07-10T10:00:00.000Z",
          } as SyncChange,
        ],
        baseSeq,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ accepted: 0, rejected: 0, conflicts: 1, appliedCount: 0 });
      expect(body.outcomes[0]).toMatchObject({
        recordId: "cat-1",
        status: "conflict",
        reasonCode: "stale_change_rejected",
        serverUpdatedAt: "2026-07-10T12:00:00.000Z",
      });
      expect(createServerBackupMock).toHaveBeenCalledWith(
        "sync_local_wins",
        expect.objectContaining({
          protected: true,
          reason: "local_wins_non_fast_forward",
          details: expect.objectContaining({
            baseSeq,
            overlappingRecords: [{ tableName: updatedTable, recordId: updatedRecordId, serverSeq }],
          }),
        }),
      );
      expect(db.prepare("SELECT id FROM categories ORDER BY id").all()).toEqual([
        { id: "cat-1" },
        { id: "cat-child" },
      ]);
      expect(db.prepare("SELECT note FROM time_entries WHERE id = ?").get("entry-child")).toEqual({
        note: "服务器上的新内容",
      });
      expect(db.prepare("SELECT * FROM sync_tombstones").all()).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM sync_seq").get()).toEqual({ count: 2 });
    },
  );

  it("rejects an old incoming entry when its overlap deletion target changed after baseSeq", async () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-overlap-newer",
      "cat-1",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T10:00:00.000Z",
      "服务器上的新内容",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T12:00:00.000Z",
    );
    const baseSeq = Number(
      db
        .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
        .run("time_entries", "entry-overlap-newer", "create").lastInsertRowid,
    );
    const serverSeq = Number(
      db
        .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
        .run("time_entries", "entry-overlap-newer", "update").lastInsertRowid,
    );

    const res = await pushChanges(
      [
        {
          tableName: "time_entries",
          recordId: "entry-incoming-old",
          action: "create",
          data: {
            id: "entry-incoming-old",
            categoryId: "cat-1",
            startTime: "2026-05-08T09:30:00.000Z",
            endTime: "2026-05-08T10:30:00.000Z",
            note: "旧设备来包",
            createdAt: "2026-05-08T09:30:00.000Z",
            updatedAt: "2026-05-08T10:00:00.000Z",
          },
          timestamp: "2026-05-08T10:00:00.000Z",
        } as SyncChange,
      ],
      baseSeq,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 0, rejected: 0, conflicts: 1, appliedCount: 0 });
    expect(body.outcomes[0]).toMatchObject({
      recordId: "entry-incoming-old",
      status: "conflict",
      reasonCode: "stale_change_rejected",
      serverUpdatedAt: "2026-05-08T12:00:00.000Z",
    });
    expect(createServerBackupMock).toHaveBeenCalledWith(
      "sync_local_wins",
      expect.objectContaining({
        details: expect.objectContaining({
          overlappingRecords: [
            { tableName: "time_entries", recordId: "entry-overlap-newer", serverSeq },
          ],
        }),
      }),
    );
    expect(db.prepare("SELECT note FROM time_entries WHERE id = ?").get("entry-overlap-newer")).toEqual({
      note: "服务器上的新内容",
    });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("entry-incoming-old")).toBeUndefined();
    expect(db.prepare("SELECT * FROM sync_tombstones").all()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_seq").get()).toEqual({ count: 2 });
  });

  it("freezes staleGuard timestamps so earlier changes cannot reject a later entry in the same push", async () => {
    const insertEntry = db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertEntry.run(
      "entry-a",
      "cat-1",
      "2026-05-08T06:00:00.000Z",
      "2026-05-08T07:00:00.000Z",
      "A old",
      "2026-05-08T06:00:00.000Z",
      "2026-05-08T08:00:00.000Z",
    );
    insertEntry.run(
      "entry-b",
      "cat-1",
      "2026-05-08T07:00:00.000Z",
      "2026-05-08T08:00:00.000Z",
      "B old",
      "2026-05-08T07:00:00.000Z",
      "2026-05-08T08:00:00.000Z",
    );

    const response = await pushChanges(
      [
        {
          tableName: "time_entries",
          recordId: "entry-a",
          action: "update",
          data: {
            id: "entry-a",
            categoryId: "cat-1",
            startTime: "2026-05-08T07:00:00.000Z",
            endTime: "2026-05-08T08:00:00.000Z",
            note: "A moved",
            createdAt: "2026-05-08T06:00:00.000Z",
            updatedAt: "2026-05-08T10:00:00.000Z",
          },
          timestamp: "2026-05-08T10:00:00.000Z",
        } as SyncChange,
        {
          tableName: "time_entries",
          recordId: "entry-b",
          action: "update",
          data: {
            id: "entry-b",
            categoryId: "cat-1",
            startTime: "2026-05-08T08:00:00.000Z",
            endTime: "2026-05-08T09:00:00.000Z",
            note: "B moved",
            createdAt: "2026-05-08T07:00:00.000Z",
            updatedAt: "2026-05-08T10:00:00.000Z",
          },
          timestamp: "2026-05-08T10:00:00.000Z",
        } as SyncChange,
      ],
      null,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: 2,
      rejected: 0,
      conflicts: 0,
    });
    expect(db.prepare("SELECT id, start_time, end_time, note FROM time_entries ORDER BY id").all()).toEqual([
      {
        id: "entry-a",
        start_time: "2026-05-08T07:00:00.000Z",
        end_time: "2026-05-08T08:00:00.000Z",
        note: "A moved",
      },
      {
        id: "entry-b",
        start_time: "2026-05-08T08:00:00.000Z",
        end_time: "2026-05-08T09:00:00.000Z",
        note: "B moved",
      },
    ]);
    expect(
      db.prepare("SELECT 1 FROM sync_tombstones WHERE table_name = 'time_entries' AND record_id = ?").get("entry-b"),
    ).toBeUndefined();
  });

  it("rolls back business rows, seq, and tombstones when the nth apply fails", async () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-rollback-remote",
      "cat-1",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T10:00:00.000Z",
      "必须保留",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T09:00:00.000Z",
    );
    db.exec(`
      CREATE TRIGGER fail_second_change_seq
      BEFORE INSERT ON sync_seq
      WHEN NEW.table_name = 'settings' AND NEW.record_id = 'rollback-setting'
      BEGIN
        SELECT RAISE(ABORT, 'injected nth apply failure');
      END;
    `);

    const res = await pushChanges(
      [
        {
          tableName: "time_entries",
          recordId: "entry-rollback-incoming",
          action: "create",
          data: {
            id: "entry-rollback-incoming",
            categoryId: "cat-1",
            startTime: "2026-05-08T09:30:00.000Z",
            endTime: "2026-05-08T10:30:00.000Z",
            note: "事务中第一条",
            createdAt: "2026-05-08T09:30:00.000Z",
            updatedAt: "2026-05-08T09:30:00.000Z",
          },
          timestamp: "2026-05-08T09:30:00.000Z",
        } as SyncChange,
        {
          tableName: "settings",
          recordId: "rollback-setting",
          action: "create",
          data: {
            key: "rollback-setting",
            value: "should-not-persist",
            updatedAt: "2026-05-08T10:00:00.000Z",
          },
          timestamp: "2026-05-08T10:00:00.000Z",
        } as SyncChange,
      ],
      0,
    );

    expect(res.status).toBe(500);
    expect(db.prepare("SELECT note FROM time_entries WHERE id = ?").get("entry-rollback-remote")).toEqual({
      note: "必须保留",
    });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("entry-rollback-incoming")).toBeUndefined();
    expect(db.prepare("SELECT key FROM settings WHERE key = ?").get("rollback-setting")).toBeUndefined();
    expect(db.prepare("SELECT * FROM sync_seq").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM sync_tombstones").all()).toEqual([]);
    expect(
      db.prepare("SELECT action FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1").get(
        "push_failed_after_backup",
      ),
    ).toEqual({ action: "push_failed_after_backup" });
  });

  it("同步往返保留 completedCount 与 recurrence.count", async () => {
    const task = {
      id: "task-count",
      title: "做三次",
      done: false,
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 3 },
      lastDoneAt: null,
      startAt: "2026-06-14T00:00:00.000Z",
      scheduledAt: null,
      sortOrder: 0,
      completedCount: 2,
      weight: 0,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    };
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "tasks",
            recordId: "task-count",
            action: "create",
            data: task,
            timestamp: "2026-06-14T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const row = db.prepare("SELECT completed_count, recurrence FROM tasks WHERE id = ?").get("task-count") as {
      completed_count: number;
      recurrence: string;
    };
    expect(row.completed_count).toBe(2);
    expect(JSON.parse(row.recurrence)).toMatchObject({ count: 3 });

    const pullRes = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });
    const pullBody = await pullRes.json();
    expect(pullBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: "tasks",
          recordId: "task-count",
          data: expect.objectContaining({ completedCount: 2, recurrence: expect.objectContaining({ count: 3 }) }),
        }),
      ]),
    );
  });

  it("push 删除 occurrence 任务经路由整链归档死因、tasks 行消失、tombstone 留痕", async () => {
    const createRes = await pushChanges([taskChange("create", taskData({ id: "task-occ-del" }))], 0);
    expect(createRes.status).toBe(200);

    const deleteRes = await pushChanges([
      taskDeleteChange("task-occ-del", "2026-07-04T01:00:00.000Z", "occurrence"),
    ]);
    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });

    expect(db.prepare("SELECT id FROM tasks WHERE id = ?").get("task-occ-del")).toBeUndefined();
    expect(
      db.prepare("SELECT deleted_at FROM sync_tombstones WHERE table_name = 'tasks' AND record_id = ?").get(
        "task-occ-del",
      ),
    ).toEqual({ deleted_at: expect.any(String) });

    const archiveRows = db
      .prepare("SELECT delete_reason, payload FROM deleted_tasks_archive WHERE task_id = ?")
      .all("task-occ-del") as { delete_reason: string; payload: string }[];
    expect(archiveRows).toHaveLength(1);
    expect(archiveRows[0].delete_reason).toBe("occurrence");
    expect(JSON.parse(archiveRows[0].payload)).toMatchObject({ id: "task-occ-del" });

    // 重复推同一条 delete（重试/回声）：tombstone 幂等覆盖，归档不应重复写入
    const repeatRes = await pushChanges([
      taskDeleteChange("task-occ-del", "2026-07-04T01:00:00.000Z", "occurrence"),
    ]);
    expect(repeatRes.status).toBe(200);

    const archiveRowsAfterRepeat = db
      .prepare("SELECT id FROM deleted_tasks_archive WHERE task_id = ?")
      .all("task-occ-del");
    expect(archiveRowsAfterRepeat).toHaveLength(1);
  });

  it("tasks 完成语义 op：A 勾选后 B 无 op 改标题不翻回 done", async () => {
    const createRes = await pushChanges([taskChange("create", taskData())], 0);
    expect(createRes.status).toBe(200);

    const completedAt = "2026-07-04T01:00:00.000Z";
    const completeRes = await pushChanges([
      taskChange(
        "update",
        taskData({ done: true, completedAt, updatedAt: completedAt }),
        { type: "complete", at: completedAt },
      ),
    ]);
    expect(completeRes.status).toBe(200);

    const titleAt = "2026-07-04T02:00:00.000Z";
    const titleRes = await pushChanges([
      taskChange("update", taskData({ title: "B 改的标题", updatedAt: titleAt })),
    ]);
    expect(titleRes.status).toBe(200);
    await expect(titleRes.json()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });

    const row = db.prepare("SELECT title, done, completed_at FROM tasks WHERE id = ?").get("task-1") as {
      title: string;
      done: number;
      completed_at: string | null;
    };
    expect(row).toEqual({
      title: "B 改的标题",
      done: 1,
      completed_at: completedAt,
    });

    const pullRes = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });
    expect(pullRes.status).toBe(200);
    const pullBody = await pullRes.json();
    expect(pullBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: "tasks",
          recordId: "task-1",
          data: expect.objectContaining({ title: "B 改的标题", done: true, completedAt }),
        }),
      ]),
    );
  });

  it("returns resolver skipReason for skipped push outcomes", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "time_entries",
            recordId: "entry-missing-category",
            action: "create",
            data: {
              id: "entry-missing-category",
              categoryId: "missing-category",
              startTime: "2026-05-08T09:00:00.000Z",
              endTime: "2026-05-08T10:00:00.000Z",
              note: null,
              createdAt: "2026-05-08T09:00:00.000Z",
              updatedAt: "2026-05-08T09:00:00.000Z",
            },
            timestamp: "2026-05-08T09:00:00.000Z",
          },
        ],
      }),
    });

    const body = await res.json();
    expect(body.outcomes[0]).toEqual(expect.objectContaining({ reasonCode: "missing_category" }));
  });

  it("deletes a category through sync push and exposes a category tombstone on pull", async () => {
    const pushRes = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "categories",
            recordId: "cat-1",
            action: "delete",
            data: null,
            timestamp: "2026-05-08T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(pushRes.status).toBe(200);
    await expect(pushRes.json()).resolves.toMatchObject({ accepted: 1, rejected: 0, conflicts: 0 });
    expect(db.prepare("SELECT id FROM categories WHERE id = ?").get("cat-1")).toBeUndefined();
    expect(
      db.prepare("SELECT * FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get("categories", "cat-1"),
    ).toMatchObject({
      table_name: "categories",
      record_id: "cat-1",
    });

    const pullRes = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0, lastSyncedAt: null }),
    });

    expect(pullRes.status).toBe(200);
    const pullBody = await pullRes.json();
    expect(pullBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "categories", recordId: "cat-1", action: "delete", data: null }),
      ]),
    );
  });

  it("deletes category descendants and records tombstones for each category", async () => {
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("cat-child", "子分类", "cat-1", "#22c55e", "2026-05-08T08:00:00.000Z", "2026-05-08T08:00:00.000Z");
    db.prepare(
      "INSERT INTO categories (id, name, parent_id, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "cat-grandchild",
      "异常三级分类",
      "cat-child",
      "#f97316",
      "2026-05-08T08:00:00.000Z",
      "2026-05-08T08:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-grandchild",
      "cat-grandchild",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T10:00:00.000Z",
      null,
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T09:00:00.000Z",
    );

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "categories",
            recordId: "cat-1",
            action: "delete",
            data: null,
            timestamp: "2026-05-08T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM categories").get()).toMatchObject({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM time_entries").get()).toMatchObject({ count: 0 });
    expect(
      db.prepare("SELECT record_id FROM sync_tombstones WHERE table_name = ? ORDER BY record_id").all("categories"),
    ).toEqual([{ record_id: "cat-1" }, { record_id: "cat-child" }, { record_id: "cat-grandchild" }]);
  });

  it("orders entry deletes before category deletes to satisfy foreign keys", async () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-cat-1",
      "cat-1",
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T10:00:00.000Z",
      null,
      "2026-05-08T09:00:00.000Z",
      "2026-05-08T09:00:00.000Z",
    );

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "categories",
            recordId: "cat-1",
            action: "delete",
            data: null,
            timestamp: "2026-05-08T10:00:00.000Z",
          },
          {
            tableName: "time_entries",
            recordId: "entry-cat-1",
            action: "delete",
            data: null,
            timestamp: "2026-05-08T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ accepted: 2, rejected: 0, conflicts: 0 });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = ?").get("entry-cat-1")).toBeUndefined();
    expect(db.prepare("SELECT id FROM categories WHERE id = ?").get("cat-1")).toBeUndefined();
  });

  it("rejects invalid push request shapes before sync validation", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "time_entries",
            recordId: "entry-1",
            action: "create",
            data: null,
            timestamp: "2026-05-08T09:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  it("includes tombstones in pull responses", async () => {
    db.prepare("INSERT INTO sync_tombstones (table_name, record_id, deleted_at) VALUES (?, ?, ?)").run(
      "time_entries",
      "entry-deleted",
      "2026-05-08T11:00:00.000Z",
    );
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "time_entries",
      "entry-deleted",
      "delete",
    );

    const res = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changes).toContainEqual({
      tableName: "time_entries",
      recordId: "entry-deleted",
      action: "delete",
      data: null,
      timestamp: "2026-05-08T11:00:00.000Z",
    });
  });

  it("includes settings in full seq pull responses", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "sleep.categoryId",
      "cat-1",
      "2026-05-30T00:00:00.000Z",
    );
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "settings",
      "sleep.categoryId",
      "update",
    );

    const res = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changes).toContainEqual({
      tableName: "settings",
      recordId: "sleep.categoryId",
      action: "update",
      data: { key: "sleep.categoryId", value: "cat-1", updatedAt: "2026-05-30T00:00:00.000Z" },
      timestamp: "2026-05-30T00:00:00.000Z",
    });
  });

  it("pushes, pulls, and tombstones quick notes", async () => {
    const pushRes = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
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
          },
        ],
      }),
    });

    expect(pushRes.status).toBe(200);
    expect(db.prepare("SELECT text, occurred_at FROM quick_notes WHERE id = ?").get("note-1")).toMatchObject({
      text: "repo",
      occurred_at: "2026-06-01T04:01:30.123Z",
    });

    const pullRes = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });

    expect(pullRes.status).toBe(200);
    const pullBody = await pullRes.json();
    // updatedAt/timestamp 由服务器分配，不与客户端提交时间比较。
    expect(pullBody.changes).toContainEqual(
      expect.objectContaining({
        tableName: "quick_notes",
        recordId: "note-1",
        action: "update",
        data: expect.objectContaining({
          id: "note-1",
          text: "repo",
          occurredAt: "2026-06-01T04:01:30.123Z",
          createdAt: "2026-06-01T04:02:00.000Z",
        }),
      }),
    );

    const deleteRes = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "quick_notes",
            recordId: "note-1",
            action: "delete",
            data: null,
            timestamp: "2026-06-01T04:03:00.000Z",
          },
        ],
      }),
    });

    expect(deleteRes.status).toBe(200);
    expect(db.prepare("SELECT id FROM quick_notes WHERE id = ?").get("note-1")).toBeUndefined();
    expect(
      db.prepare("SELECT table_name, record_id FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(
        "quick_notes",
        "note-1",
      ),
    ).toMatchObject({ table_name: "quick_notes", record_id: "note-1" });
  });

  it("pushes, pulls, and tombstones tracks and track_steps", async () => {
    const now = "2026-06-21T00:00:00.000Z";
    const pushRes = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "track_steps",
            recordId: "step-1",
            action: "create",
            data: {
              id: "step-1",
              trackId: "track-1",
              source: "agent",
              sourceLabel: "codex",
              content: "",
              startedAt: now,
              endedAt: null,
              refs: [{ kind: "commit", id: "abc123" }],
              tags: ["phase:T1"],
              seq: 0,
              createdAt: now,
              updatedAt: now,
            },
            timestamp: now,
          },
          {
            tableName: "tracks",
            recordId: "track-1",
            action: "create",
            data: {
              id: "track-1",
              title: "T1 数据地基",
              status: "active",
              refs: [{ kind: "task", id: "task-1" }],
              createdAt: now,
              updatedAt: now,
            },
            timestamp: now,
          },
        ],
      }),
    });

    expect(pushRes.status).toBe(200);
    await expect(pushRes.json()).resolves.toMatchObject({ accepted: 2, rejected: 0, conflicts: 0 });
    expect(db.prepare("SELECT title, refs FROM tracks WHERE id = ?").get("track-1")).toMatchObject({
      title: "T1 数据地基",
      refs: JSON.stringify([{ kind: "task", id: "task-1" }]),
    });
    expect(db.prepare("SELECT track_id, content, tags FROM track_steps WHERE id = ?").get("step-1")).toMatchObject({
      track_id: "track-1",
      content: "",
      tags: JSON.stringify(["phase:T1"]),
    });

    const pullRes = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: 0 }),
    });
    expect(pullRes.status).toBe(200);
    const pullBody = await pullRes.json();
    expect(pullBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: "tracks",
          recordId: "track-1",
          action: "update",
          data: expect.objectContaining({ title: "T1 数据地基", refs: [{ kind: "task", id: "task-1" }] }),
        }),
        expect.objectContaining({
          tableName: "track_steps",
          recordId: "step-1",
          action: "update",
          data: expect.objectContaining({ trackId: "track-1", content: "", tags: ["phase:T1"] }),
        }),
      ]),
    );

    const deleteRes = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          { tableName: "tracks", recordId: "track-1", action: "delete", data: null, timestamp: now },
          { tableName: "track_steps", recordId: "step-1", action: "delete", data: null, timestamp: now },
        ],
      }),
    });

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ accepted: 2, rejected: 0, conflicts: 0 });
    expect(db.prepare("SELECT id FROM track_steps WHERE id = ?").get("step-1")).toBeUndefined();
    expect(db.prepare("SELECT id FROM tracks WHERE id = ?").get("track-1")).toBeUndefined();
    expect(
      db.prepare("SELECT table_name, record_id FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(
        "track_steps",
        "step-1",
      ),
    ).toMatchObject({ table_name: "track_steps", record_id: "step-1" });
    expect(
      db.prepare("SELECT table_name, record_id FROM sync_tombstones WHERE table_name = ? AND record_id = ?").get(
        "tracks",
        "track-1",
      ),
    ).toMatchObject({ table_name: "tracks", record_id: "track-1" });
  });

  it("pulls deduplicated changes after a seq cursor and returns latest seq", async () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-seq",
      "Seq 分类",
      "#22c55e",
      "2026-05-08T10:00:00.000Z",
      "2026-05-08T11:00:00.000Z",
    );
    db.prepare(
      `
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      "entry-seq",
      "cat-seq",
      "2026-05-08T11:00:00.000Z",
      "2026-05-08T12:00:00.000Z",
      "seq record",
      "2026-05-08T11:00:00.000Z",
      "2026-05-08T11:00:00.000Z",
    );
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "categories",
      "cat-old",
      "update",
    );
    const baseSeq = db
      .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
      .run("categories", "cat-seq", "create").lastInsertRowid as number;
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "categories",
      "cat-seq",
      "update",
    );
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "time_entries",
      "entry-seq",
      "create",
    );
    const latestSeq = Number(db.prepare("SELECT MAX(id) as seq FROM sync_seq").get().seq);

    const res = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ lastSyncedAt: "1970-01-01T00:00:00.000Z", sinceSeq: baseSeq }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latestSeq).toBe(latestSeq);
    expect(body.changes).toEqual([
      expect.objectContaining({ tableName: "categories", recordId: "cat-seq", action: "update" }),
      expect.objectContaining({ tableName: "time_entries", recordId: "entry-seq", action: "update" }),
    ]);
  });

  it("pulls settings after a seq cursor", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "sleep.categoryId",
      "cat-1",
      "2026-05-30T00:00:00.000Z",
    );
    const baseSeq = db
      .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
      .run("categories", "cat-old", "update").lastInsertRowid as number;
    const settingSeq = db
      .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
      .run("settings", "sleep.categoryId", "update").lastInsertRowid as number;

    const res = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ lastSyncedAt: "1970-01-01T00:00:00.000Z", sinceSeq: baseSeq }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latestSeq).toBe(Number(settingSeq));
    expect(body.changes).toEqual([
      expect.objectContaining({ tableName: "settings", recordId: "sleep.categoryId", action: "update" }),
    ]);
  });

  it("pulls CLI-created entries from /pull when the client uses sinceSeq", async () => {
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "categories",
      "cat-work",
      "create",
    );
    const beforeSeq = Number(db.prepare("SELECT MAX(id) as seq FROM sync_seq").get().seq);
    const created = createEntryFromCliInput(
      db,
      {
        date: "2026-05-08",
        start: "09:00",
        end: "10:00",
        category: "工作",
        note: "CLI 写入",
      },
      { now: new Date("2026-05-08T10:00:00+08:00") },
    );

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected success");

    const res = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ lastSyncedAt: "1970-01-01T00:00:00.000Z", sinceSeq: beforeSeq }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "time_entries", recordId: created.entry.id })]),
    );
  });

  it("creates a protected backup and rejects stale non-fast-forward overlapping pushes", async () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-overlap",
      "server name",
      "#4A90D9",
      "2026-05-08T08:00:00.000Z",
      "2026-05-08T12:00:00.000Z",
    );
    const baseSeq = db
      .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
      .run("categories", "cat-overlap", "create").lastInsertRowid as number;
    const serverSeq = Number(
      db
        .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
        .run("categories", "cat-overlap", "update").lastInsertRowid,
    );

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq,
        changes: [
          {
            tableName: "categories",
            recordId: "cat-overlap",
            action: "update",
            data: {
              id: "cat-overlap",
              name: "local name",
              parentId: null,
              color: "#22c55e",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-08T08:00:00.000Z",
              updatedAt: "2026-05-08T10:00:00.000Z",
            },
            timestamp: "2026-05-08T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 0, rejected: 0, conflicts: 1, backupId: "sync_local_wins-backup-1" });
    expect(body.outcomes[0]).toMatchObject({
      recordId: "cat-overlap",
      status: "conflict",
      reasonCode: "stale_change_rejected",
      serverUpdatedAt: "2026-05-08T12:00:00.000Z",
    });
    expect(createServerBackupMock).toHaveBeenCalledWith("sync_local_wins", {
      protected: true,
      reason: "local_wins_non_fast_forward",
      details: {
        baseSeq,
        cloudAheadCount: 1,
        overlappingRecords: [{ tableName: "categories", recordId: "cat-overlap", serverSeq }],
        pushedRecords: [{ tableName: "categories", recordId: "cat-overlap", action: "update" }],
      },
    });
    expect(markServerBackupProtectedMock).not.toHaveBeenCalled();
    expect(db.prepare("SELECT name FROM categories WHERE id = ?").get("cat-overlap")).toMatchObject({
      name: "server name",
    });
  });

  it("allows a non-fast-forward overlapping push when the incoming timestamp is newer", async () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-overlap-newer",
      "server name",
      "#4A90D9",
      "2026-05-08T08:00:00.000Z",
      "2026-05-08T12:00:00.000Z",
    );
    const baseSeq = db
      .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
      .run("categories", "cat-overlap-newer", "create").lastInsertRowid as number;
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)").run(
      "categories",
      "cat-overlap-newer",
      "update",
    );

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq,
        changes: [
          {
            tableName: "categories",
            recordId: "cat-overlap-newer",
            action: "update",
            data: {
              id: "cat-overlap-newer",
              name: "local newer name",
              parentId: null,
              color: "#22c55e",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-08T08:00:00.000Z",
              updatedAt: "2099-01-01T00:00:00.000Z",
            },
            timestamp: "2099-01-01T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 0, conflicts: 0, backupId: "sync_local_wins-backup-1" });
    expect(db.prepare("SELECT name FROM categories WHERE id = ?").get("cat-overlap-newer")).toMatchObject({
      name: "local newer name",
    });
  });

  it("does not compare timestamps for fast-forward pushes", async () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-fast-forward",
      "server name",
      "#4A90D9",
      "2026-05-08T08:00:00.000Z",
      "2026-05-08T12:00:00.000Z",
    );
    const baseSeq = db
      .prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES (?, ?, ?)")
      .run("categories", "cat-fast-forward", "create").lastInsertRowid as number;

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSeq,
        changes: [
          {
            tableName: "categories",
            recordId: "cat-fast-forward",
            action: "update",
            data: {
              id: "cat-fast-forward",
              name: "fast-forward name",
              parentId: null,
              color: "#22c55e",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-08T08:00:00.000Z",
              updatedAt: "2026-05-08T10:00:00.000Z",
            },
            timestamp: "2026-05-08T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 0, conflicts: 0, backupId: null });
    expect(db.prepare("SELECT name FROM categories WHERE id = ?").get("cat-fast-forward")).toMatchObject({
      name: "fast-forward name",
    });
  });

  it("enables staleGuard for unknown-base pushes", async () => {
    db.prepare("INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "cat-unknown-base",
      "server name",
      "#4A90D9",
      "2026-05-08T08:00:00.000Z",
      "2026-05-08T12:00:00.000Z",
    );

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          {
            tableName: "categories",
            recordId: "cat-unknown-base",
            action: "update",
            data: {
              id: "cat-unknown-base",
              name: "local stale name",
              parentId: null,
              color: "#22c55e",
              icon: null,
              sortOrder: 0,
              isArchived: false,
              createdAt: "2026-05-08T08:00:00.000Z",
              updatedAt: "2026-05-08T10:00:00.000Z",
            },
            timestamp: "2026-05-08T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 0, rejected: 0, conflicts: 1, backupId: "backup-1" });
    expect(body.outcomes[0]).toMatchObject({
      recordId: "cat-unknown-base",
      status: "conflict",
      reasonCode: "stale_change_rejected",
    });
    expect(db.prepare("SELECT name FROM categories WHERE id = ?").get("cat-unknown-base")).toMatchObject({
      name: "server name",
    });
  });

  it("writeSyncLog truncates detail exceeding 4096 characters", async () => {
    // Send a push that generates a large sync_log detail by including many outcomes
    // Use force-push flow which logs detailed outcomes
    const changes = Array.from({ length: 100 }, (_, i) => ({
      tableName: "categories" as const,
      recordId: `cat-new-${i}`,
      action: "update" as const,
      data: {
        id: `cat-new-${i}`,
        name: `category-name-that-is-quite-long-${"x".repeat(50)}`,
        parentId: null,
        color: "#22c55e",
        icon: null,
        sortOrder: i,
        isArchived: false,
        createdAt: "2026-05-08T08:00:00.000Z",
        updatedAt: "2026-05-08T09:00:00.000Z",
      },
      timestamp: "2026-05-08T09:00:00.000Z",
    }));

    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });

    expect(res.status).toBe(200);
    // The push_received log entry should have its detail truncated if > 4096
    const logRow = db
      .prepare("SELECT detail FROM sync_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
      .get("push_received") as { detail: string };
    expect(logRow.detail.length).toBeLessThanOrEqual(4096);
  });
});

describe("push requestId 幂等", () => {
  // 幂等契约：同 requestId 二次 push 命中回放表直接返回原响应，不重复 apply、不产生新 seq；
  // 校验 409 与成功 200 都回放（状态码也回放）；备份竞态 409 与 500 路径不落回放行，
  // 客户端应带同 requestId 重试并真正重新执行那两条路径。
  function categoryCreateChange(id: string, timestamp = "2026-07-01T00:00:00.000Z") {
    return {
      tableName: "categories",
      recordId: id,
      action: "create",
      timestamp,
      data: {
        id,
        name: id,
        parentId: null,
        color: "#123456",
        icon: null,
        sortOrder: 0,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
  }

  // 引用一个数据库与本批都不存在的分类，validateEntryChange 会在校验阶段拒收 → 409（不进入 apply）。
  function missingCategoryEntryChange(id: string, timestamp = "2026-07-01T00:00:00.000Z") {
    return {
      tableName: "time_entries",
      recordId: id,
      action: "create",
      timestamp,
      data: {
        id,
        categoryId: "missing-category-does-not-exist",
        startTime: timestamp,
        endTime: "2026-07-01T01:00:00.000Z",
        note: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
  }

  function pushRequestRowCount(): number {
    return (db.prepare("SELECT COUNT(*) AS n FROM sync_push_requests").get() as { n: number }).n;
  }

  it("同 requestId 重放：返回原响应、不重复 apply、seq 不再推进", async () => {
    const change = categoryCreateChange("cat-idem-1") as unknown as SyncChange;

    const first = await pushChanges([change], 0, "req-idem-1");
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const seqAfterFirst = latestSeq();

    // 完全相同 body 再发一次（category 域每次 apply 都无条件覆盖并记 seq，天然能暴露"是否重复 apply"）。
    const replay = await pushChanges([change], 0, "req-idem-1");
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();

    expect(replayBody).toEqual(firstBody);
    expect(latestSeq()).toBe(seqAfterFirst);
    expect((db.prepare("SELECT COUNT(*) AS n FROM categories WHERE id = ?").get("cat-idem-1") as { n: number }).n).toBe(1);
    expect(pushRequestRowCount()).toBe(1);
  });

  it("重放响应保留原 latestSeq——期间他人推进 seq 也不变（客户端 canSkipEchoPull 会因此走回 pull，安全）", async () => {
    const change = categoryCreateChange("cat-idem-2") as unknown as SyncChange;

    const first = await pushChanges([change], 0, "req-idem-2");
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // 另一 requestId 推进 seq（不带 requestId 走旧路径）。
    const other = await pushChanges([categoryCreateChange("cat-idem-2-other") as unknown as SyncChange], latestSeq());
    expect(other.status).toBe(200);
    expect(latestSeq()).toBeGreaterThan(firstBody.latestSeq);

    const replay = await pushChanges([change], 0, "req-idem-2");
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();

    expect(replayBody.latestSeq).toBe(firstBody.latestSeq);
    expect(replayBody).toEqual(firstBody);
  });

  it("校验 409 同样回放", async () => {
    const change = missingCategoryEntryChange("entry-idem-1") as unknown as SyncChange;

    const first = await pushChanges([change], 0, "req-idem-3");
    expect(first.status).toBe(409);
    const firstBody = await first.json();

    const replay = await pushChanges([change], 0, "req-idem-3");
    expect(replay.status).toBe(409);
    const replayBody = await replay.json();

    expect(replayBody).toEqual(firstBody);
    expect((db.prepare("SELECT COUNT(*) AS n FROM time_entries").get() as { n: number }).n).toBe(0);
  });

  it("不带 requestId 完全走旧路径且不落回放行", async () => {
    const res = await pushChanges([categoryCreateChange("cat-idem-4") as unknown as SyncChange], 0);
    expect(res.status).toBe(200);
    expect(pushRequestRowCount()).toBe(0);
  });

  it("TTL：超 24h 的回放行在下一次带 requestId 的 push 时被清理", async () => {
    db.prepare(`
      INSERT INTO sync_push_requests (request_id, status_code, response_json, created_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'))
    `).run("stale-req", 200, JSON.stringify({ ok: true }));

    const res = await pushChanges([categoryCreateChange("cat-idem-5") as unknown as SyncChange], 0, "req-idem-5");
    expect(res.status).toBe(200);

    expect(db.prepare("SELECT 1 FROM sync_push_requests WHERE request_id = ?").get("stale-req")).toBeUndefined();
  });
});
