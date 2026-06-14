import Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let app: Hono;
let db: Database.Database;

async function setupGarminRoutes(): Promise<void> {
  db = new Database(":memory:");
  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db, getDbPath: () => ":memory:" }));
  const { initializeDatabase } = await import("../db/schema.js");
  initializeDatabase();
  db.prepare("DELETE FROM sync_logs").run();
  const { Hono } = await import("hono");
  const { garminRoutes } = await import("./garminRoutes.js");
  app = new Hono().route("/api/admin/garmin", garminRoutes);
}

function request(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`/api/admin/garmin${path}`, init);
}

async function saveConfig(body: Record<string, unknown>): Promise<Response> {
  return request("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await setupGarminRoutes();
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
  vi.restoreAllMocks();
});

describe("Garmin config routes", () => {
  it("saves and returns initialBackfillDays", async () => {
    const saved = await saveConfig({ email: "user@example.com", password: "secret", initialBackfillDays: 14 });
    expect(saved.status).toBe(200);

    const res = await request("/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: "user@example.com",
      password: "********",
      initialBackfillDays: 14,
    });
  });

  it("rejects initialBackfillDays outside 1..30", async () => {
    const res = await saveConfig({ initialBackfillDays: 31 });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_config" });
  });
});

describe("Garmin fetch route validation", () => {
  beforeEach(async () => {
    await saveConfig({ email: "user@example.com", password: "secret", initialBackfillDays: 7 });
  });

  it("rejects mixing explicit dates with days", async () => {
    const res = await request("/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: "2026-06-01", endDate: "2026-06-02", days: 3 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_request" });
  });

  it("rejects one-sided explicit dates", async () => {
    const res = await request("/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: "2026-06-01" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_request" });
  });

  it("returns no-op and writes audit when daily health data is current", async () => {
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    const now = "2026-06-13T00:00:00.000Z";
    db.prepare(`
      INSERT INTO health_heart_rate (id, date, created_at, updated_at)
      VALUES ('hr-1', '2026-06-13', ?, ?)
    `).run(now, now);
    db.prepare("INSERT INTO health_hrv (id, date, hrv_ms, created_at, updated_at) VALUES ('hrv-1', '2026-06-13', 45, ?, ?)")
      .run(now, now);
    db.prepare("INSERT INTO health_sleep (id, date, sleep_start, wake_time, adjustment_hours, created_at, updated_at) VALUES ('sleep-1', '2026-06-13', '23:00', '07:00', 0, ?, ?)")
      .run(now, now);
    db.prepare("INSERT INTO health_stress (id, date, stress, created_at, updated_at) VALUES ('stress-1', '2026-06-13', 20, ?, ?)")
      .run(now, now);
    db.prepare("INSERT INTO sync_seq (table_name, record_id, action) VALUES ('health_hrv', 'hrv-1', 'create')")
      .run();
    const latestSeq = (db.prepare("SELECT MAX(id) AS value FROM sync_seq").get() as { value: number }).value;

    const res = await request("/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "no_op" });
    expect(db.prepare("SELECT device, action, record_count FROM sync_logs").get()).toEqual({
      device: "garmin",
      action: "garmin_fetch",
      record_count: 0,
    });
    const detailRow = db.prepare("SELECT detail FROM sync_logs").get() as { detail: string };
    expect(JSON.parse(detailRow.detail)).toMatchObject({
      latestSeqBefore: latestSeq,
      latestSeqAfter: latestSeq,
    });
  });
});
