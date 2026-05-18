import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

function syncLogRequest(path = "", init?: RequestInit): Promise<Response> {
  return app.request(`/api/admin/sync-logs${path}`, init);
}

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/admin/sync-logs", "../routes/syncLog.js");
  app = setup.app;
  db = setup.db;
  db.prepare("DELETE FROM sync_logs").run();
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

describe("POST /api/admin/sync-logs", () => {
  it("accepts a single valid entry", async () => {
    const res = await syncLogRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "desktop", action: "push", detail: "ok", record_count: 1 }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: 1 });
    expect(db.prepare("SELECT device, action, detail, record_count FROM sync_logs").get()).toEqual({
      device: "desktop",
      action: "push",
      detail: "ok",
      record_count: 1,
    });
  });

  it("accepts arrays with up to 100 valid entries", async () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ action: "push", record_count: i }));

    const res = await syncLogRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: 100 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 100 });
  });

  it("rejects arrays with more than 100 entries", async () => {
    const entries = Array.from({ length: 101 }, () => ({ action: "push" }));

    const res = await syncLogRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });

    expect(res.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 0 });
  });

  it("rejects entries without action", async () => {
    const res = await syncLogRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "desktop" }),
    });

    expect(res.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 0 });
  });

  it("rejects entries with device over 100 characters", async () => {
    const res = await syncLogRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "push", device: "a".repeat(101) }),
    });

    expect(res.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 0 });
  });
});

describe("GET /api/admin/sync-logs", () => {
  beforeEach(() => {
    const insert = db.prepare("INSERT INTO sync_logs (device, action, record_count) VALUES (?, ?, ?)");
    for (let i = 0; i < 600; i++) {
      insert.run("test", `action-${i}`, i);
    }
  });

  it("returns latest entries up to the requested limit", async () => {
    const res = await syncLogRequest("?limit=3");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; action: string }>;
    expect(body).toHaveLength(3);
    expect(body.map((entry) => entry.action)).toEqual(["action-599", "action-598", "action-597"]);
  });

  it("defaults limit to 50", async () => {
    const res = await syncLogRequest();

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(50);
  });

  it("clamps limit values above 500 to 500", async () => {
    const res = await syncLogRequest("?limit=9999");

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(500);
  });

  it("clamps limit values below 1 to 1", async () => {
    const res = await syncLogRequest("?limit=-5");

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });
});

describe("DELETE /api/admin/sync-logs", () => {
  it("requires explicit confirmation", async () => {
    db.prepare("INSERT INTO sync_logs (action) VALUES (?)").run("push");

    const res = await syncLogRequest("", { method: "DELETE" });

    expect(res.status).toBe(412);
    expect(await res.json()).toEqual({ error: "CONFIRMATION_REQUIRED", hint: "send header X-Confirm: true" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 1 });
  });

  it("clears all logs with explicit confirmation", async () => {
    db.prepare("INSERT INTO sync_logs (action) VALUES (?)").run("push");

    const res = await syncLogRequest("", { method: "DELETE", headers: { "X-Confirm": "true" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 0 });
  });
});
