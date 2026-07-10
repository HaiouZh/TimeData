import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRouteTestDb, seedEntry, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;
let createServerBackupMock: ReturnType<typeof vi.fn>;
let notifySyncChangeMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  createServerBackupMock = vi.fn(async () => ({
    id: "data-reset-backup-1",
    path: "backup.db",
    createdAt: "2026-05-13T10:00:00.000Z",
    operation: "data_reset",
  }));
  notifySyncChangeMock = vi.fn();
  vi.doMock("../sync/backup.js", () => ({ createServerBackup: createServerBackupMock }));
  vi.doMock("../sync/notifier.js", () => ({ notifySyncChange: notifySyncChangeMock }));

  const setup = await setupRouteTestApp("/api/data", "../routes/data.js");
  app = setup.app;
  db = setup.db;
});

afterEach(() => {
  cleanupRouteTestDb(db);
  vi.doUnmock("../sync/backup.js");
  vi.doUnmock("../sync/notifier.js");
});

describe("data route reset", () => {
  it("creates a short-lived reset confirmation token", async () => {
    const res = await app.request("/api/data/reset/prepare", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmationPhrase).toBe("RESET_DATA");
    expect(body.confirmToken).toEqual(expect.any(String));
    expect(body.confirmToken.length).toBeGreaterThan(20);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("rejects reset without a valid confirmation phrase", async () => {
    const res = await app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid confirmation phrase" });
    expect(createServerBackupMock).not.toHaveBeenCalled();
  });

  it("rejects reset with a correct phrase but missing token", async () => {
    const res = await app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationPhrase: "RESET_DATA" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid or expired token" });
    expect(createServerBackupMock).not.toHaveBeenCalled();
  });

  it("rejects reset with a prepared token but wrong phrase", async () => {
    const prep = await app.request("/api/data/reset/prepare", { method: "POST" });
    const { confirmToken } = await prep.json();

    const res = await app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken, confirmationPhrase: "wrong" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid confirmation phrase" });
    expect(createServerBackupMock).not.toHaveBeenCalled();
  });

  it("resets with a prepared token and correct phrase, creates a protected backup, and consumes the token", async () => {
    seedEntry(db, { id: "entry-before-reset", categoryId: "cat-sleep" });
    const prep = await app.request("/api/data/reset/prepare", { method: "POST" });
    const { confirmToken } = await prep.json();

    const res = await app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken, confirmationPhrase: "RESET_DATA" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      backupId: string;
      categories: number;
      entriesDeleted: number;
      resetAt: string;
    };
    expect(body.backupId).toBe("data-reset-backup-1");
    expect(body.entriesDeleted).toBe(1);
    expect(body.categories).toBeGreaterThan(0);
    expect(typeof body.resetAt).toBe("string");
    expect(createServerBackupMock).toHaveBeenCalledWith("data_reset", {
      protected: true,
      reason: "manual_data_reset",
    });
    const latestSeq = (db.prepare("SELECT MAX(id) AS value FROM sync_seq").get() as { value: number }).value;
    expect(latestSeq).toBeGreaterThan(0);
    expect(notifySyncChangeMock).toHaveBeenCalledOnce();
    expect(notifySyncChangeMock).toHaveBeenCalledWith(latestSeq);
    expect(db.prepare("SELECT COUNT(*) AS count FROM time_entries").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM categories").get()).toEqual({ count: body.categories });

    const replay = await app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken, confirmationPhrase: "RESET_DATA" }),
    });
    expect(replay.status).toBe(403);
  });

  it("lets a device with a pre-reset high cursor pull deletes and the rebuilt defaults", async () => {
    seedEntry(db, { id: "entry-visible-to-high-cursor", categoryId: "cat-sleep" });
    db.prepare(`
      INSERT INTO sync_seq (table_name, record_id, action)
      VALUES ('time_entries', 'entry-visible-to-high-cursor', 'create')
    `).run();
    const preResetCursor = (db.prepare("SELECT MAX(id) AS value FROM sync_seq").get() as { value: number }).value;

    const syncRoute = (await import("../routes/sync.js")).default;
    app.route("/api/sync", syncRoute);

    const prep = await app.request("/api/data/reset/prepare", { method: "POST" });
    const { confirmToken } = await prep.json();
    const reset = await app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken, confirmationPhrase: "RESET_DATA" }),
    });
    expect(reset.status).toBe(200);

    const pull = await app.request("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceSeq: preResetCursor }),
    });
    expect(pull.status).toBe(200);
    const body = (await pull.json()) as {
      changes: Array<{ tableName: string; recordId: string; action: string }>;
      latestSeq: number;
    };
    expect(body.latestSeq).toBeGreaterThan(preResetCursor);
    expect(body.changes).toEqual(
      expect.arrayContaining([
        {
          tableName: "time_entries",
          recordId: "entry-visible-to-high-cursor",
          action: "delete",
          data: null,
          timestamp: expect.any(String),
        },
        expect.objectContaining({
          tableName: "categories",
          recordId: "cat-sleep",
          action: "update",
        }),
      ]),
    );
  });

  it("rejects reset when the ledger advances while the safety backup is being created", async () => {
    seedEntry(db, { id: "entry-created-before-reset", categoryId: "cat-sleep" });
    const categoriesBefore = db.prepare("SELECT COUNT(*) AS count FROM categories").get();
    db.prepare(`
      INSERT INTO sync_seq (table_name, record_id, action)
      VALUES ('time_entries', 'entry-created-before-reset', 'create')
    `).run();

    let resolveBackupStarted!: () => void;
    const backupStarted = new Promise<void>((resolve) => {
      resolveBackupStarted = resolve;
    });
    let resolveBackup!: (backup: {
      id: string;
      path: string;
      createdAt: string;
      operation: string;
    }) => void;
    const pendingBackup = new Promise<{
      id: string;
      path: string;
      createdAt: string;
      operation: string;
    }>((resolve) => {
      resolveBackup = resolve;
    });
    createServerBackupMock.mockImplementationOnce(() => {
      resolveBackupStarted();
      return pendingBackup;
    });

    const prep = await app.request("/api/data/reset/prepare", { method: "POST" });
    const { confirmToken } = await prep.json();
    const resetRequest = app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken, confirmationPhrase: "RESET_DATA" }),
    });

    await backupStarted;
    db.prepare(`
      INSERT INTO sync_seq (table_name, record_id, action)
      VALUES ('quick_notes', 'write-during-backup', 'create')
    `).run();
    resolveBackup({
      id: "data-reset-backup-raced",
      path: "backup-raced.db",
      createdAt: "2026-05-13T10:01:00.000Z",
      operation: "data_reset",
    });

    const response = await resetRequest;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Server data changed while the safety backup was being created. Retry reset.",
    });
    expect(db.prepare("SELECT id FROM time_entries WHERE id = 'entry-created-before-reset'").get()).toEqual({
      id: "entry-created-before-reset",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM categories").get()).toEqual(categoriesBefore);
    expect(notifySyncChangeMock).not.toHaveBeenCalled();
  });

  it("does not expose reset through GET", async () => {
    const res = await app.request("/api/data/reset");

    expect(res.status).toBe(404);
  });
});
