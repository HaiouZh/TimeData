import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;
let app: Hono;
let tempDir: string;
let dbPath: string;

const now = "2026-05-08T08:00:00.000Z";

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
      updated_at TEXT NOT NULL
    );

    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      note TEXT,
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

    CREATE TABLE api_request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      token_tier TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      client_hint TEXT,
      device_label TEXT,
      duration_ms INTEGER NOT NULL
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
  `);
}

function seed() {
  const insertCategory = db.prepare(`
    INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCategory.run("cat-work", "工作", null, "#4A90D9", "briefcase", 1, 0, now, now);
  insertCategory.run("cat-code", "编程", "cat-work", "#7ED321", "code", 1, 0, now, now);
  insertCategory.run("cat-archived", "归档", null, "#9B9B9B", "archive", 99, 1, now, "2026-05-08T08:10:00.000Z");

  const insertEntry = db.prepare(`
    INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertEntry.run(
    "entry-normal",
    "cat-code",
    "2026-05-08T09:00:00.000Z",
    "2026-05-08T10:00:00.000Z",
    "正常记录",
    now,
    "2026-05-08T10:00:00.000Z",
  );
  insertEntry.run(
    "entry-missing-category",
    "cat-missing",
    "2026-05-08T10:30:00.000Z",
    "2026-05-08T11:00:00.000Z",
    "missing category",
    now,
    "2026-05-08T11:00:00.000Z",
  );
  insertEntry.run(
    "entry-archived-category",
    "cat-archived",
    "2026-05-08T11:30:00.000Z",
    "2026-05-08T12:00:00.000Z",
    "archived category",
    now,
    "2026-05-08T12:00:00.000Z",
  );
  insertEntry.run(
    "entry-invalid-time",
    "cat-code",
    "2026-05-08T13:00:00.000Z",
    "2026-05-08T12:30:00.000Z",
    "invalid time",
    now,
    "2026-05-08T13:00:00.000Z",
  );
  insertEntry.run(
    "entry-overlap-a",
    "cat-code",
    "2026-05-08T14:00:00.000Z",
    "2026-05-08T15:00:00.000Z",
    "overlap a",
    now,
    "2026-05-08T15:00:00.000Z",
  );
  insertEntry.run(
    "entry-overlap-b",
    "cat-code",
    "2026-05-08T14:30:00.000Z",
    "2026-05-08T15:30:00.000Z",
    "overlap b",
    now,
    "2026-05-08T15:30:00.000Z",
  );

  db.prepare("INSERT INTO sync_logs (timestamp, device, action, detail, record_count) VALUES (?, ?, ?, ?, ?)").run(
    "2026-05-08T16:00:00.000Z",
    "desktop",
    "push_rejected",
    JSON.stringify({ rejected: 1, conflicts: 1, outcomes: [] }),
    2,
  );
  db.prepare(`
    INSERT INTO api_request_logs (
      timestamp,
      method,
      path,
      status,
      outcome,
      token_tier,
      ip,
      user_agent,
      client_hint,
      device_label,
      duration_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "2026-05-08T16:10:00.000Z",
    "POST",
    "/api/tasks",
    401,
    "auth_failed",
    "invalid",
    "203.0.113.7",
    "Vitest",
    "agent",
    "agent",
    12,
  );
  db.prepare(`
    INSERT INTO api_request_logs (
      timestamp,
      method,
      path,
      status,
      outcome,
      token_tier,
      ip,
      user_agent,
      client_hint,
      device_label,
      duration_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "2026-05-08T16:20:00.000Z",
    "GET",
    "/api/health",
    200,
    "ok",
    "public",
    null,
    null,
    "web",
    "web",
    3,
  );
  db.prepare("INSERT INTO sync_tombstones (table_name, record_id, deleted_at) VALUES (?, ?, ?)").run(
    "time_entries",
    "entry-deleted",
    "2026-05-08T17:00:00.000Z",
  );
}

function createBackupFixture() {
  fs.mkdirSync(path.join(tempDir, "backups"), { recursive: true });
  fs.writeFileSync(path.join(tempDir, "backups", "sync_push-2026-05-08T08-00-00-000Z.db"), "backup fixture");
}

function seedBackup(entry: {
  id: string;
  operation: string;
  createdAt: string;
  protected?: boolean;
  reason?: string | null;
}) {
  const backupDir = path.join(tempDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const fileName = `${entry.id}.db`;
  const manifestPath = path.join(backupDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { backups: {} };
  manifest.backups[entry.id] = {
    id: entry.id,
    fileName,
    operation: entry.operation,
    createdAt: entry.createdAt,
    protected: entry.protected ?? false,
    reason: entry.reason ?? null,
    relatedSyncLogId: null,
    details: null,
  };
  fs.writeFileSync(path.join(backupDir, fileName), "backup fixture");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

beforeEach(async () => {
  db = new Database(":memory:");
  createSchema();
  seed();

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-admin-test-"));
  dbPath = path.join(tempDir, "timedata.db");
  createBackupFixture();

  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db, getDbPath: () => dbPath }));
  const adminRoute = (await import("./admin/index.js")).default;
  app = new Hono().route("/api/admin", adminRoute);
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  vi.doUnmock("../db/connection.js");
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("admin route", () => {
  it("returns summary counts", async () => {
    const res = await app.request("/api/admin/summary");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      counts: {
        categories: 3,
        activeCategories: 2,
        archivedCategories: 1,
        timeEntries: 6,
        syncLogs: 1,
        tombstones: 1,
        serverBackups: 1,
      },
      latest: {
        entryUpdatedAt: "2026-05-08T15:30:00.000Z",
        syncLogTimestamp: "2026-05-08T16:00:00.000Z",
        backupCreatedAt: "2026-05-08T08:00:00.000Z",
      },
    });
  });

  it("returns date-filtered paginated entries in stable descending order", async () => {
    const res = await app.request("/api/admin/entries?from=2026-05-08&to=2026-05-08&limit=2&offset=0");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ limit: 2, offset: 0, total: 6 });
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toEqual(expect.objectContaining({ id: "entry-overlap-b" }));
    expect(body.entries.map((entry: { id: string }) => entry.id)).toEqual(["entry-overlap-b", "entry-overlap-a"]);
  });

  it("returns INVALID_REQUEST when entries query params are invalid", async () => {
    const res = await app.request("/api/admin/entries?limit=bad");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("filters entries by missing-category anomaly", async () => {
    const res = await app.request("/api/admin/entries?anomaly=missing_category");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ limit: 50, offset: 0, total: 1 });
    expect(body.entries).toEqual([
      expect.objectContaining({ id: "entry-missing-category", categoryName: null, anomaly: "missing_category" }),
    ]);
  });

  it("returns category aggregates", async () => {
    const res = await app.request("/api/admin/categories");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toEqual([
      expect.objectContaining({
        id: "cat-work",
        name: "工作",
        parentId: null,
        entryCount: 0,
        totalMinutes: 0,
        isArchived: false,
      }),
      expect.objectContaining({
        id: "cat-code",
        name: "编程",
        parentId: "cat-work",
        parentName: "工作",
        entryCount: 4,
        totalMinutes: 180,
        isArchived: false,
      }),
      expect.objectContaining({ id: "cat-archived", name: "归档", entryCount: 1, totalMinutes: 30, isArchived: true }),
    ]);
  });

  it("returns sync diagnostics", async () => {
    const res = await app.request("/api/admin/sync");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      logs: [
        {
          timestamp: "2026-05-08T16:00:00.000Z",
          device: "desktop",
          action: "push_rejected",
          detail: JSON.stringify({ rejected: 1, conflicts: 1, outcomes: [] }),
          recordCount: 2,
        },
      ],
      recentRejectedCount: 1,
      recentConflictCount: 1,
    });
  });

  it("returns request audit logs using the shared response shape", async () => {
    const res = await app.request("/api/admin/request-logs?limit=1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      limit: 1,
      logs: [
        expect.objectContaining({
          timestamp: "2026-05-08T16:20:00.000Z",
          method: "GET",
          path: "/api/health",
          status: 200,
          outcome: "ok",
          tokenTier: "public",
          clientHint: "web",
          durationMs: 3,
        }),
      ],
    });
  });

  it("filters request audit logs by status, outcome, token tier, and client hint", async () => {
    const res = await app.request(
      "/api/admin/request-logs?status=401&outcome=auth_failed&tokenTier=invalid&clientHint=agent",
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/tasks",
        status: 401,
        outcome: "auth_failed",
        tokenTier: "invalid",
        clientHint: "agent",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("Authorization");
    expect(JSON.stringify(body)).not.toContain("body");
  });

  it("rejects invalid request audit limits", async () => {
    const res = await app.request("/api/admin/request-logs?limit=9999");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("counts rejected and conflicts from JSON sync details", async () => {
    db.prepare("INSERT INTO sync_logs (timestamp, device, action, detail, record_count) VALUES (?, ?, ?, ?, ?)").run(
      "2026-05-08T16:30:00.000Z",
      "desktop",
      "push_received",
      JSON.stringify({ rejected: 2, conflicts: 1, outcomes: [] }),
      0,
    );

    const res = await app.request("/api/admin/sync");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      recentRejectedCount: 2,
      recentConflictCount: 2,
    });
  });

  it("falls back to action names when sync detail is not structured", async () => {
    db.prepare("INSERT INTO sync_logs (timestamp, device, action, detail, record_count) VALUES (?, ?, ?, ?, ?)").run(
      "2026-05-08T16:45:00.000Z",
      "desktop",
      "push_conflict",
      "legacy text without counters",
      0,
    );

    const res = await app.request("/api/admin/sync");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      recentRejectedCount: 1,
      recentConflictCount: 2,
    });
  });

  it("returns server backup metadata", async () => {
    const res = await app.request("/api/admin/backups");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      backups: [
        {
          id: "sync_push-2026-05-08T08-00-00-000Z.db",
          fileName: "sync_push-2026-05-08T08-00-00-000Z.db",
          operation: "sync_push",
          createdAt: "2026-05-08T08:00:00.000Z",
        },
      ],
    });
  });

  it("classifies an old non-protected backup as deletable", async () => {
    seedBackup({
      id: "old",
      operation: "sync_push",
      createdAt: "2026-04-01T00:00:00.000Z",
      protected: false,
    });

    const res = await app.request("/api/admin/backups");

    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.backups.find((backup: { id: string }) => backup.id === "old");
    expect(row.retention).toBe("deletable");
  });

  it("deletes a backup by id including protected", async () => {
    seedBackup({
      id: "del-me",
      operation: "manual",
      createdAt: "2026-05-01T00:00:00.000Z",
      protected: true,
    });

    const res = await app.request("/api/admin/backups/del-me", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: "del-me" });
    const list = await (await app.request("/api/admin/backups")).json();
    expect(list.backups.find((backup: { id: string }) => backup.id === "del-me")).toBeUndefined();
    expect(fs.existsSync(path.join(tempDir, "backups", "del-me.db"))).toBe(false);
  });

  it("deletes an unregistered backup by file name", async () => {
    const backupDir = path.join(tempDir, "backups");
    const fileName = "sync_push-2026-05-07T08-00-00-000Z.db";
    fs.writeFileSync(path.join(backupDir, fileName), "orphan backup");

    const res = await app.request(`/api/admin/backups/${encodeURIComponent(fileName)}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: fileName });
    expect(fs.existsSync(path.join(backupDir, fileName))).toBe(false);
  });

  it("rejects backup delete ids that escape the backup directory", async () => {
    const outsidePath = path.join(tempDir, "escape.db");
    fs.writeFileSync(outsidePath, "outside backup");

    const res = await app.request("/api/admin/backups/..%2Fescape", { method: "DELETE" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(fs.existsSync(outsidePath)).toBe(true);
  });

  it("runs daily backup through admin endpoint", async () => {
    const backupDir = path.join(tempDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(
      path.join(backupDir, "manifest.json"),
      `${JSON.stringify({ backups: {}, meta: { dailyBackup: { enabled: true, timeOfDay: "00:00" }, retentionDays: 7, lastDailySeq: 999_999 } }, null, 2)}\n`,
    );

    const res = await app.request("/api/admin/backups/run-daily", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: false, backupId: null, reason: "no_change" });
  });

  it("reads and updates backup config", async () => {
    const put = await app.request("/api/admin/backup-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyBackup: { enabled: false, timeOfDay: "03:15" }, retentionDays: 14 }),
    });

    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      config: { dailyBackup: { enabled: false, timeOfDay: "03:15" }, retentionDays: 14 },
    });

    const get = await app.request("/api/admin/backup-config");
    expect(await get.json()).toEqual({
      config: { dailyBackup: { enabled: false, timeOfDay: "03:15" }, retentionDays: 14 },
    });
  });

  it("rejects invalid backup config", async () => {
    const res = await app.request("/api/admin/backup-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyBackup: { enabled: true, timeOfDay: "9pm" }, retentionDays: 0 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("skips backup files that cannot be statted", async () => {
    const brokenFileName = "sync_push-2026-05-08T09-00-00-000Z.db";
    const backupDir = path.join(tempDir, "backups");
    fs.writeFileSync(path.join(backupDir, brokenFileName), "broken backup fixture");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const statSync = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((filePath, options) => {
      if (filePath === path.join(backupDir, brokenFileName)) {
        const error = new Error("stat failed") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return statSync(filePath, options as never) as never;
    });

    const res = await app.request("/api/admin/backups");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backups).toHaveLength(1);
    expect(body.backups[0].fileName).toBe("sync_push-2026-05-08T08-00-00-000Z.db");
    expect(warnSpy).toHaveBeenCalledWith("[backup] unable to stat backup file", {
      fileName: brokenFileName,
      error: expect.any(Error),
    });
  });

  it("returns health checks for data anomalies", async () => {
    db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "entry-future-time",
      "cat-code",
      "2099-05-09T17:00:00.000Z",
      "2099-05-09T17:30:00.000Z",
      "future time",
      now,
      "2099-05-09T17:30:00.000Z",
    );

    const res = await app.request("/api/admin/health-checks");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks).toEqual(
      expect.arrayContaining([
        {
          code: "invalid_time_range",
          severity: "error",
          count: 2,
          sampleIds: ["entry-invalid-time", "entry-future-time"],
        },
        { code: "missing_category", severity: "error", count: 1, sampleIds: ["entry-missing-category"] },
        { code: "archived_category", severity: "warning", count: 1, sampleIds: ["entry-archived-category"] },
        { code: "overlap", severity: "warning", count: 2, sampleIds: ["entry-overlap-a", "entry-overlap-b"] },
      ]),
    );
  });

  it("detects overlaps across categories and start dates", async () => {
    const insertEntry = db.prepare(`
      INSERT INTO time_entries (id, category_id, start_time, end_time, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertEntry.run(
      "entry-cross-category-a",
      "cat-code",
      "2026-05-08T18:00:00.000Z",
      "2026-05-08T19:00:00.000Z",
      "cross category a",
      now,
      "2026-05-08T19:00:00.000Z",
    );
    insertEntry.run(
      "entry-cross-category-b",
      "cat-work",
      "2026-05-08T18:30:00.000Z",
      "2026-05-08T18:45:00.000Z",
      "cross category b",
      now,
      "2026-05-08T18:45:00.000Z",
    );
    insertEntry.run(
      "entry-cross-date-a",
      "cat-code",
      "2026-05-08T23:30:00.000Z",
      "2026-05-09T00:30:00.000Z",
      "cross date a",
      now,
      "2026-05-09T00:30:00.000Z",
    );
    insertEntry.run(
      "entry-cross-date-b",
      "cat-code",
      "2026-05-09T00:00:00.000Z",
      "2026-05-09T01:00:00.000Z",
      "cross date b",
      now,
      "2026-05-09T01:00:00.000Z",
    );

    const res = await app.request("/api/admin/health-checks");

    expect(res.status).toBe(200);
    const body = await res.json();
    const overlap = body.checks.find((check: { code: string }) => check.code === "overlap");
    expect(overlap).toMatchObject({ severity: "warning", count: 6 });
  });

  it("returns analytics grouped by day and category", async () => {
    const res = await app.request("/api/admin/analytics?from=2026-05-08&to=2026-05-08&groupBy=day");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      range: { from: "2026-05-08", to: "2026-05-08", groupBy: "day" },
      byTime: [{ bucket: "2026-05-08", totalMinutes: 240, entryCount: 5 }],
      byCategory: [
        expect.objectContaining({
          categoryId: "cat-code",
          categoryName: "编程",
          parentCategoryName: "工作",
          totalMinutes: 180,
          entryCount: 3,
        }),
        expect.objectContaining({
          categoryId: "cat-missing",
          categoryName: "cat-missing",
          parentCategoryName: null,
          totalMinutes: 30,
          entryCount: 1,
        }),
        expect.objectContaining({
          categoryId: "cat-archived",
          categoryName: "归档",
          parentCategoryName: null,
          totalMinutes: 30,
          entryCount: 1,
        }),
      ],
    });
  });

  it("rejects invalid analytics date parameters", async () => {
    const res = await app.request("/api/admin/analytics?from=invalid");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns analytics for valid optional parameters", async () => {
    const res = await app.request("/api/admin/analytics?from=2026-05-08&to=2026-05-09&groupBy=week");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      range: { from: "2026-05-08", to: "2026-05-09", groupBy: "week" },
    });
  });
});
