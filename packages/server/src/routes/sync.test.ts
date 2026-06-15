import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEntryFromCliInput } from "../lib/entry-service.js";
import { computeAndPersistCommitHash, getCommitHash } from "../sync/state.js";
let db: Database.Database;
let app: Hono;
let createServerBackupMock: ReturnType<typeof vi.fn>;
let markServerBackupProtectedMock: ReturnType<typeof vi.fn>;

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
    expect(body).toMatchObject({ importedCategories: 2, importedTimeEntries: 1, backupId: "backup-1", latestSeq: 3 });
    expect(db.prepare("SELECT COUNT(*) as count FROM sync_seq").get()).toMatchObject({ count: 3 });
    expect(db.prepare("SELECT COUNT(*) as count FROM categories").get()).toMatchObject({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) as count FROM time_entries").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT name FROM categories WHERE id = ?").get("cat-1")).toBeUndefined();
    expect(db.prepare("SELECT note FROM time_entries WHERE id = ?").get("entry-local")).toMatchObject({
      note: "本地恢复后的记录",
    });
    expect(db.prepare("SELECT action FROM sync_logs WHERE action = ?").get("force_push_applied")).toMatchObject({
      action: "force_push_applied",
    });
  });

  it("force-push imports settings when provided and reports their count", async () => {
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
    expect(body).toMatchObject({ importedCategories: 0, importedTimeEntries: 0, importedSettings: 1, latestSeq: 1 });
    expect(db.prepare("SELECT value, updated_at FROM settings WHERE key = ?").get("sleep.categoryId")).toMatchObject({
      value: "cat-1",
      updated_at: "2026-05-30T00:00:00.000Z",
    });
  });

  it("force-push imports quick notes independently from categories and entries", async () => {
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
      latestSeq: 1,
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
            title: "跑步",
            done: false,
            recurrence: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" },
            lastDoneAt: null,
            startAt: "2026-06-14T00:00:00.000Z",
            scheduledAt: null,
            subtasks: [],
            sortOrder: 0,
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
      importedTasks: 1,
      latestSeq: 1,
    });
    expect(db.prepare("SELECT title, recurrence, start_at FROM tasks WHERE id = ?").get("task-force")).toMatchObject({
      title: "跑步",
      recurrence: JSON.stringify({ freq: "weekly", interval: 1, byWeekday: [1], basis: "due" }),
      start_at: "2026-06-14T00:00:00.000Z",
    });
    expect(db.prepare("SELECT table_name, record_id FROM sync_seq WHERE id = 1").get()).toMatchObject({
      table_name: "tasks",
      record_id: "task-force",
    });
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
    expect(createServerBackupMock).toHaveBeenCalledWith("sync_unknown_base");
    expect(markServerBackupProtectedMock).toHaveBeenCalledWith("backup-1", {
      protected: true,
      reason: "unknown_base",
      details: {
        baseSeq: null,
        cloudAheadCount: 0,
        overlappingRecords: [],
        pushedRecords: [{ tableName: "categories", recordId: "cat-1", action: "update" }],
      },
    });
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
    expect(body).toMatchObject({ accepted: 1, rejected: 0, conflicts: 0, backupId: "backup-1" });
    expect(body.outcomes[0]).toMatchObject({ status: "accepted", reasonCode: "applied", recordId: "entry-1" });
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

  it("creates a protected local-wins backup for non-fast-forward overlapping pushes", async () => {
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
    expect(body).toMatchObject({ accepted: 1, rejected: 0, conflicts: 0, backupId: "sync_local_wins-backup-1" });
    expect(createServerBackupMock).toHaveBeenCalledWith("sync_local_wins");
    expect(markServerBackupProtectedMock).toHaveBeenCalledWith("sync_local_wins-backup-1", {
      protected: true,
      reason: "local_wins_non_fast_forward",
      details: {
        baseSeq,
        cloudAheadCount: 1,
        overlappingRecords: [{ tableName: "categories", recordId: "cat-overlap", serverSeq }],
        pushedRecords: [{ tableName: "categories", recordId: "cat-overlap", action: "update" }],
      },
    });
    expect(db.prepare("SELECT name FROM categories WHERE id = ?").get("cat-overlap")).toMatchObject({
      name: "local name",
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
