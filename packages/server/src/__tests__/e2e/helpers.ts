import Database from "better-sqlite3";
import type { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export interface E2EServer {
  app: Hono;
  db: Database.Database;
  close: () => void;
}

export async function startE2EServer(): Promise<E2EServer> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-e2e-"));
  const dbPath = path.join(tempDir, "timedata.db");

  vi.resetModules();
  vi.doMock("../../db/connection.js", () => ({ getDb: () => db, getDbPath: () => dbPath }));
  vi.doMock("../../sync/backup.js", () => ({
    createServerBackup: vi.fn(async (operation: string) => ({
      id: `${operation}-e2e-backup`,
      path: path.join(tempDir, `${operation}.db`),
      createdAt: "2026-05-13T08:00:00.000Z",
      operation,
      protected: false,
      reason: null,
      relatedSyncLogId: null,
      details: null,
    })),
    markServerBackupProtected: vi.fn(),
  }));

  const { Hono } = await import("hono");
  const { initializeDatabase } = await import("../../db/schema.js");
  const categoriesRoute = (await import("../../routes/categories.js")).default;
  const entriesRoute = (await import("../../routes/entries.js")).default;
  const syncRoute = (await import("../../routes/sync.js")).default;
  const syncLogRoute = (await import("../../routes/syncLog.js")).default;

  initializeDatabase();

  const app = new Hono();
  app.route("/api/categories", categoriesRoute);
  app.route("/api/entries", entriesRoute);
  app.route("/api/sync", syncRoute);
  app.route("/api/sync-logs", syncLogRoute);

  return {
    app,
    db,
    close: () => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
      vi.doUnmock("../../db/connection.js");
      vi.doUnmock("../../sync/backup.js");
    },
  };
}
