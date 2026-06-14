import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;

beforeEach(async () => {
  db = new Database(":memory:");
  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db, getDbPath: () => ":memory:" }));
  const { initializeDatabase } = await import("../db/schema.js");
  initializeDatabase();
  db.exec(`
    DELETE FROM sync_logs;
    DELETE FROM sync_seq;
    DELETE FROM health_heart_rate;
    DELETE FROM health_hrv;
    DELETE FROM health_sleep;
    DELETE FROM health_stress;
    DELETE FROM runs;
  `);
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
  vi.restoreAllMocks();
});

function insertDaily(table: string, date: string): void {
  const now = `${date}T00:00:00.000Z`;
  if (table === "health_heart_rate") {
    db.prepare(`
      INSERT INTO health_heart_rate
        (id, date, resting_heart_rate, min_heart_rate, max_heart_rate, avg_heart_rate, last_7_days_avg_resting_heart_rate, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`${table}-${date}`, date, 60, 50, 100, 70, 61, now, now);
    return;
  }
  if (table === "health_hrv") {
    db.prepare("INSERT INTO health_hrv (id, date, hrv_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(`${table}-${date}`, date, 45, now, now);
    return;
  }
  if (table === "health_sleep") {
    db.prepare(`
      INSERT INTO health_sleep (id, date, sleep_start, wake_time, adjustment_hours, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`${table}-${date}`, date, "23:00", "07:00", 0, now, now);
    return;
  }
  db.prepare("INSERT INTO health_stress (id, date, stress, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(`${table}-${date}`, date, 20, now, now);
}

describe("resolveGarminFetchRange", () => {
  it("uses initialBackfillDays when no daily health data exists", async () => {
    const { resolveGarminFetchRange } = await import("./garminService.js");

    const range = resolveGarminFetchRange(
      {},
      { initialBackfillDays: 7 },
      {},
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(range).toEqual({ noOp: false, startDate: "2026-06-07", endDate: "2026-06-13" });
  });

  it("returns no-op when every daily domain is already synced through yesterday", async () => {
    const { resolveGarminFetchRange } = await import("./garminService.js");

    const range = resolveGarminFetchRange(
      {},
      { initialBackfillDays: 7 },
      {
        health_heart_rate: "2026-06-13",
        health_hrv: "2026-06-13",
        health_sleep: "2026-06-13",
        health_stress: "2026-06-13",
      },
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(range).toEqual({ noOp: true, startDate: "2026-06-13", endDate: "2026-06-13" });
  });

  it("starts from the earliest lagging daily domain", async () => {
    const { resolveGarminFetchRange } = await import("./garminService.js");

    const range = resolveGarminFetchRange(
      {},
      { initialBackfillDays: 7 },
      {
        health_heart_rate: "2026-06-13",
        health_hrv: "2026-06-01",
        health_sleep: "2026-06-12",
        health_stress: "2026-06-13",
      },
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(range).toEqual({ noOp: false, startDate: "2026-06-02", endDate: "2026-06-13" });
  });

  it("uses explicit dates without consulting latest dates", async () => {
    const { resolveGarminFetchRange } = await import("./garminService.js");

    const range = resolveGarminFetchRange(
      { startDate: "2026-06-01", endDate: "2026-06-03" },
      { initialBackfillDays: 7 },
      { health_hrv: "2026-06-13" },
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(range).toEqual({ noOp: false, startDate: "2026-06-01", endDate: "2026-06-03" });
  });

  it("supports manual days refetch ending yesterday", async () => {
    const { resolveGarminFetchRange } = await import("./garminService.js");

    const range = resolveGarminFetchRange(
      { days: 7 },
      { initialBackfillDays: 3 },
      { health_hrv: "2026-06-13" },
      new Date("2026-06-14T12:00:00.000Z"),
    );

    expect(range).toEqual({ noOp: false, startDate: "2026-06-07", endDate: "2026-06-13" });
  });

  it("rejects mixed explicit dates and days", async () => {
    const { resolveGarminFetchRange } = await import("./garminService.js");

    expect(() =>
      resolveGarminFetchRange(
        { startDate: "2026-06-01", endDate: "2026-06-03", days: 7 },
        { initialBackfillDays: 7 },
        {},
        new Date("2026-06-14T12:00:00.000Z"),
      ),
    ).toThrow(/cannot combine dates with days/);
  });

  it("rejects explicit ranges longer than 90 days", async () => {
    const { resolveGarminFetchRange } = await import("./garminService.js");

    expect(() =>
      resolveGarminFetchRange(
        { startDate: "2026-01-01", endDate: "2026-04-02" },
        { initialBackfillDays: 7 },
        {},
        new Date("2026-06-14T12:00:00.000Z"),
      ),
    ).toThrow(/range cannot exceed 90 days/);
  });
});

describe("getGarminDailyLatestDates", () => {
  it("reads latest date from daily health domains and ignores runs", async () => {
    const { getGarminDailyLatestDates } = await import("./garminService.js");
    insertDaily("health_heart_rate", "2026-06-10");
    insertDaily("health_heart_rate", "2026-06-12");
    insertDaily("health_hrv", "2026-06-11");
    insertDaily("health_sleep", "2026-06-09");
    insertDaily("health_stress", "2026-06-08");
    db.prepare(`
      INSERT INTO runs (id, date, start_time, created_at, updated_at)
      VALUES ('run-1', '2026-06-13', '07:00', '2026-06-13T00:00:00.000Z', '2026-06-13T00:00:00.000Z')
    `).run();

    expect(getGarminDailyLatestDates(db)).toEqual({
      health_heart_rate: "2026-06-12",
      health_hrv: "2026-06-11",
      health_sleep: "2026-06-09",
      health_stress: "2026-06-08",
    });
  });
});

describe("resolveGarminScriptPath", () => {
  it("returns the first existing candidate path", async () => {
    const { resolveGarminScriptPath } = await import("./garminService.js");
    const dir = mkdtempSync(join(tmpdir(), "timedata-garmin-"));
    const script = join(dir, "garminFetch.py");
    writeFileSync(script, "print('ok')\n", "utf8");

    try {
      expect(resolveGarminScriptPath(["missing.py", script])).toBe(script);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a structured script_not_found error when no candidate exists", async () => {
    const { resolveGarminScriptPath } = await import("./garminService.js");

    expect(() => resolveGarminScriptPath(["missing-a.py", "missing-b.py"])).toThrow(/script_not_found/);
  });
});

describe("recordGarminFetchAudit", () => {
  it("writes a garmin sync log with seq boundaries and counts", async () => {
    const { recordGarminFetchAudit } = await import("./garminService.js");

    recordGarminFetchAudit(db, {
      runId: "run-1",
      trigger: "manual",
      status: "success",
      startDate: "2026-06-12",
      endDate: "2026-06-13",
      counts: { health_hrv: 2 },
      errors: [],
      latestSeqBefore: 10,
      latestSeqAfter: 12,
    });

    const row = db.prepare("SELECT device, action, record_count, detail FROM sync_logs").get() as {
      device: string;
      action: string;
      record_count: number;
      detail: string;
    };
    expect(row.device).toBe("garmin");
    expect(row.action).toBe("garmin_fetch");
    expect(row.record_count).toBe(2);
    expect(JSON.parse(row.detail)).toMatchObject({
      runId: "run-1",
      trigger: "manual",
      status: "success",
      latestSeqBefore: 10,
      latestSeqAfter: 12,
    });
  });
});
