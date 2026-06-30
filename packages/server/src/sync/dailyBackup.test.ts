import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-daily-test-"));

vi.stubEnv("DB_PATH", path.join(tempRoot, "timedata.db"));

const { getDb } = await import("../db/connection.js");
const { initializeDatabase } = await import("../db/schema.js");
const { readBackupMeta, writeBackupMeta } = await import("./backup.js");
const { runDailyBackupIfDue } = await import("./dailyBackup.js");
const { recordSeq } = await import("./seq.js");

beforeEach(() => {
  initializeDatabase();
  getDb().exec("DELETE FROM sync_logs; DELETE FROM sync_tombstones; DELETE FROM time_entries; DELETE FROM categories;");
  fs.rmSync(path.join(tempRoot, "backups"), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function bumpSeq() {
  return recordSeq("settings", `k-${crypto.randomUUID()}`, "create");
}

describe("runDailyBackupIfDue", () => {
  it("skips when disabled", async () => {
    writeBackupMeta({ dailyBackup: { enabled: false, timeOfDay: "00:00" } });

    await expect(runDailyBackupIfDue(new Date("2026-06-30T23:00:00.000Z"))).resolves.toMatchObject({
      created: false,
      backupId: null,
      reason: "disabled",
    });
  });

  it("skips before configured local time", async () => {
    writeBackupMeta({ dailyBackup: { enabled: true, timeOfDay: "23:59" } });

    await expect(runDailyBackupIfDue(new Date("2026-06-30T00:00:00.000Z"))).resolves.toMatchObject({
      created: false,
      backupId: null,
      reason: "before_time",
    });
  });

  it("skips when no data change since last daily", async () => {
    writeBackupMeta({ dailyBackup: { enabled: true, timeOfDay: "00:00" }, lastDailySeq: 999_999 });

    await expect(runDailyBackupIfDue(new Date("2026-06-30T12:00:00.000Z"))).resolves.toMatchObject({
      created: false,
      backupId: null,
      reason: "no_change",
    });
  });

  it("creates auto_daily once per local day and records latest seq", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-30T12:00:00.000Z"));
    writeBackupMeta({ dailyBackup: { enabled: true, timeOfDay: "00:00" }, lastDailySeq: 0 });
    const latestSeq = bumpSeq();

    const first = await runDailyBackupIfDue(new Date("2026-06-30T12:00:00.000Z"));

    expect(first).toMatchObject({ created: true, reason: "created" });
    expect(first.backupId).toContain("auto_daily");
    expect(readBackupMeta().lastDailySeq).toBe(latestSeq);

    vi.setSystemTime(new Date("2026-06-30T13:00:00.000Z"));
    const second = await runDailyBackupIfDue(new Date("2026-06-30T13:00:00.000Z"));
    expect(second).toMatchObject({ created: false, backupId: null, reason: "already_today" });
  });
});
