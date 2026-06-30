import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-backup-test-"));
const dbPath = path.join(tempRoot, "timedata.db");

vi.stubEnv("DB_PATH", dbPath);

const { getDb } = await import("../db/connection.js");
const { initializeDatabase } = await import("../db/schema.js");
const { createServerBackup, cleanupServerBackups, readBackupManifest, readBackupMeta, writeBackupMeta } = await import(
  "./backup.js"
);

beforeEach(() => {
  const db = getDb();
  initializeDatabase();
  db.exec("DELETE FROM sync_logs; DELETE FROM sync_tombstones; DELETE FROM time_entries; DELETE FROM categories;");
  fs.rmSync(path.join(tempRoot, "backups"), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readBackupManifest", () => {
  it("returns an empty manifest without warning when the manifest does not exist", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(readBackupManifest()).toEqual({ backups: {} });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns and returns an empty manifest when reading the manifest fails for a non-ENOENT error", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      const error = new Error("permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    });

    expect(readBackupManifest()).toEqual({ backups: {} });

    expect(warnSpy).toHaveBeenCalledWith("[backup] failed to read manifest", expect.any(Error));
  });
});

describe("backup meta", () => {
  it("returns defaults when manifest has no meta", () => {
    expect(readBackupMeta()).toEqual({
      dailyBackup: { enabled: true, timeOfDay: "04:00" },
      retentionDays: 7,
      lastDailySeq: 0,
    });
  });

  it("merges and persists meta without touching backups", async () => {
    const backup = await createServerBackup("manual", { protected: true });

    writeBackupMeta({ retentionDays: 14, lastDailySeq: 42 });
    writeBackupMeta({ dailyBackup: { enabled: false, timeOfDay: "02:30" } });

    const manifest = readBackupManifest();
    expect(manifest.backups[backup.id]).toBeDefined();
    expect(manifest.meta).toEqual({
      dailyBackup: { enabled: false, timeOfDay: "02:30" },
      retentionDays: 14,
      lastDailySeq: 42,
    });
  });

  it("falls back to defaults for invalid persisted meta fields", () => {
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(
      path.join(backupDir, "manifest.json"),
      `${JSON.stringify(
        {
          backups: {},
          meta: {
            dailyBackup: { enabled: "yes", timeOfDay: "9pm" },
            retentionDays: 0,
            lastDailySeq: -1,
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(readBackupMeta()).toEqual({
      dailyBackup: { enabled: true, timeOfDay: "04:00" },
      retentionDays: 7,
      lastDailySeq: 0,
    });
  });
});

describe("createServerBackup", () => {
  it("creates a SQLite backup file before server mutation", async () => {
    const db = getDb();
    db.prepare("INSERT INTO sync_logs (device, action, detail, record_count) VALUES (?, ?, ?, ?)").run(
      "test",
      "before_backup",
      "{}",
      1,
    );

    const backup = await createServerBackup("sync_push");

    expect(backup.id).toContain("sync_push");
    expect(fs.existsSync(backup.path)).toBe(true);
    expect(fs.statSync(backup.path).size).toBeGreaterThan(0);
  });
  it("writes manifest metadata for protected local-wins backups", async () => {
    const backup = await createServerBackup("sync_local_wins", {
      protected: true,
      reason: "local_wins_non_fast_forward",
      details: {
        baseSeq: 10,
        cloudAheadCount: 1,
        overlappingRecords: [{ tableName: "time_entries", recordId: "entry-local", serverSeq: 11 }],
      },
    });

    const manifestPath = path.join(tempRoot, "backups", "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(manifest.backups[backup.id]).toMatchObject({
      id: backup.id,
      fileName: `${backup.id}.db`,
      operation: "sync_local_wins",
      protected: true,
      reason: "local_wins_non_fast_forward",
      relatedSyncLogId: null,
      details: {
        baseSeq: 10,
        cloudAheadCount: 1,
        overlappingRecords: [{ tableName: "time_entries", recordId: "entry-local", serverSeq: 11 }],
      },
    });
  });

  it("triggers cleanup after creating a server backup", async () => {
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });

    const manifest = {
      backups: {
        stale_keep: {
          id: "stale_keep",
          fileName: "stale_keep.db",
          operation: "sync_push",
          createdAt: "2000-01-01T12:00:00.000Z",
          protected: false,
          reason: null,
          relatedSyncLogId: null,
          details: null,
        },
        stale_delete: {
          id: "stale_delete",
          fileName: "stale_delete.db",
          operation: "sync_push",
          createdAt: "2000-01-01T00:00:00.000Z",
          protected: false,
          reason: null,
          relatedSyncLogId: null,
          details: null,
        },
      },
    };

    for (const entry of Object.values(manifest.backups)) {
      fs.writeFileSync(path.join(backupDir, entry.fileName), "backup fixture");
    }
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    await createServerBackup("sync_push");
    await new Promise((resolve) => setImmediate(resolve));

    expect(fs.existsSync(path.join(backupDir, "stale_keep.db"))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, "stale_delete.db"))).toBe(false);
  });

  it("logs structured cleanup results after creating a server backup", async () => {
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });

    const manifest = {
      backups: {
        stale_keep: {
          id: "stale_keep",
          fileName: "stale_keep.db",
          operation: "sync_push",
          createdAt: "2000-01-01T12:00:00.000Z",
          protected: false,
          reason: null,
          relatedSyncLogId: null,
          details: null,
        },
        stale_delete: {
          id: "stale_delete",
          fileName: "stale_delete.db",
          operation: "sync_push",
          createdAt: "2000-01-01T00:00:00.000Z",
          protected: false,
          reason: null,
          relatedSyncLogId: null,
          details: null,
        },
      },
    };

    fs.writeFileSync(path.join(backupDir, "stale_keep.db"), "backup fixture");
    fs.writeFileSync(path.join(backupDir, "stale_delete.db"), "backup fixture");
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const backup = await createServerBackup("sync_push");
    await new Promise((resolve) => setImmediate(resolve));

    expect(logSpy).toHaveBeenCalledWith("[backup] cleanup removed old backups", {
      backupId: backup.id,
      operation: "sync_push",
      removedCount: 2,
    });
  });

  it("logs structured cleanup failures after creating a server backup", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rmSync = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementation((filePath, options) => {
      if (typeof filePath === "string" && filePath.endsWith("stale_delete.db")) {
        throw new Error("cleanup failed");
      }
      return rmSync(filePath, options as never) as never;
    });
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const manifest = {
      backups: {
        stale_keep: {
          id: "stale_keep",
          fileName: "stale_keep.db",
          operation: "sync_push",
          createdAt: "2000-01-01T12:00:00.000Z",
          protected: false,
          reason: null,
          relatedSyncLogId: null,
          details: null,
        },
        stale_delete: {
          id: "stale_delete",
          fileName: "stale_delete.db",
          operation: "sync_push",
          createdAt: "2000-01-01T00:00:00.000Z",
          protected: false,
          reason: null,
          relatedSyncLogId: null,
          details: null,
        },
      },
    };
    fs.writeFileSync(path.join(backupDir, "stale_keep.db"), "backup fixture");
    fs.writeFileSync(path.join(backupDir, "stale_delete.db"), "backup fixture");
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const backup = await createServerBackup("sync_push");
    await new Promise((resolve) => setImmediate(resolve));

    expect(warnSpy).toHaveBeenCalledWith("[backup] cleanup failed", {
      backupId: backup.id,
      operation: "sync_push",
      error: expect.any(Error),
    });
  });

  it("keeps protected and within-window, deletes old non-protected (flat window)", async () => {
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });

    const mk = (id: string, createdAt: string, protectedBackup: boolean, operation = "auto_daily") => ({
      id,
      fileName: `${id}.db`,
      operation,
      createdAt,
      protected: protectedBackup,
      reason: null,
      relatedSyncLogId: null,
      details: null,
    });
    const manifest = {
      backups: {
        prot_old: mk("prot_old", "2026-01-01T00:00:00.000Z", true, "manual"),
        fresh: mk("fresh", "2026-06-29T00:00:00.000Z", false),
        stale: mk("stale", "2026-06-10T00:00:00.000Z", false),
      },
    };

    for (const entry of Object.values(manifest.backups)) {
      fs.writeFileSync(path.join(backupDir, entry.fileName), "x");
    }
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const removed = cleanupServerBackups(new Date("2026-06-30T00:00:00.000Z"), 7);

    expect(removed).toEqual(["stale"]);
    expect(fs.existsSync(path.join(backupDir, "prot_old.db"))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, "fresh.db"))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, "stale.db"))).toBe(false);
  });

  it("deletes old non-protected orphans but keeps protected-class orphans", async () => {
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, "sync_push-2026-06-01T00-00-00-000Z.db"), "x");
    fs.writeFileSync(path.join(backupDir, "auto_daily-2026-06-29T00-00-00-000Z.db"), "x");
    fs.writeFileSync(path.join(backupDir, "sync_force_push-2026-01-01T00-00-00-000Z.db"), "x");
    fs.writeFileSync(path.join(backupDir, "data_reset-2026-01-01T00-00-00-000Z.db"), "x");
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify({ backups: {} }, null, 2)}\n`);

    const removed = cleanupServerBackups(new Date("2026-06-30T00:00:00.000Z"), 7);

    expect(removed).toEqual(["sync_push-2026-06-01T00-00-00-000Z.db"]);
    expect(fs.existsSync(path.join(backupDir, "auto_daily-2026-06-29T00-00-00-000Z.db"))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, "sync_force_push-2026-01-01T00-00-00-000Z.db"))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, "data_reset-2026-01-01T00-00-00-000Z.db"))).toBe(true);
  });

  it("keeps old protected-class manifest entries even when legacy manifests missed the protected flag", async () => {
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const entry = {
      id: "sync_force_push-legacy",
      fileName: "sync_force_push-legacy.db",
      operation: "sync_force_push",
      createdAt: "2026-01-01T00:00:00.000Z",
      protected: false,
      reason: null,
      relatedSyncLogId: null,
      details: null,
    };
    fs.writeFileSync(path.join(backupDir, entry.fileName), "x");
    fs.writeFileSync(
      path.join(backupDir, "manifest.json"),
      `${JSON.stringify({ backups: { [entry.id]: entry } }, null, 2)}\n`,
    );

    const removed = cleanupServerBackups(new Date("2026-06-30T00:00:00.000Z"), 7);

    expect(removed).toEqual([]);
    expect(fs.existsSync(path.join(backupDir, entry.fileName))).toBe(true);
    expect(readBackupManifest().backups[entry.id]).toBeDefined();
  });

  it("removes manifest entries whose backup files are missing", () => {
    const backupDir = path.join(tempRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const manifest = {
      backups: {
        missing: {
          id: "missing",
          fileName: "missing.db",
          operation: "auto_daily",
          createdAt: "2026-06-29T00:00:00.000Z",
          protected: false,
          reason: null,
          relatedSyncLogId: null,
          details: null,
        },
      },
    };
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    expect(cleanupServerBackups(new Date("2026-06-30T00:00:00.000Z"), 7)).toEqual([]);

    expect(readBackupManifest().backups.missing).toBeUndefined();
  });
});
