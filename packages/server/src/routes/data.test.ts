import Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRouteTestDb, seedEntry, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;
let createServerBackupMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  createServerBackupMock = vi.fn(async () => ({
    id: "data-reset-backup-1",
    path: "backup.db",
    createdAt: "2026-05-13T10:00:00.000Z",
    operation: "data_reset",
  }));
  vi.doMock("../sync/backup.js", () => ({ createServerBackup: createServerBackupMock }));

  const setup = await setupRouteTestApp("/api/data", "../routes/data.js");
  app = setup.app;
  db = setup.db;
});

afterEach(() => {
  cleanupRouteTestDb(db);
  vi.doUnmock("../sync/backup.js");
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
    const body = await res.json() as { backupId: string; categories: number; entriesDeleted: number; resetAt: string };
    expect(body.backupId).toBe("data-reset-backup-1");
    expect(body.entriesDeleted).toBe(1);
    expect(body.categories).toBeGreaterThan(0);
    expect(typeof body.resetAt).toBe("string");
    expect(createServerBackupMock).toHaveBeenCalledWith("data_reset", {
      protected: true,
      reason: "manual_data_reset",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM time_entries").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM categories").get()).toEqual({ count: body.categories });

    const replay = await app.request("/api/data/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken, confirmationPhrase: "RESET_DATA" }),
    });
    expect(replay.status).toBe(403);
  });

  it("does not expose reset through GET", async () => {
    const res = await app.request("/api/data/reset");

    expect(res.status).toBe(404);
  });
});
