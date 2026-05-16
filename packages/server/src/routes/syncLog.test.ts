import Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/sync-logs", "../routes/syncLog.js");
  app = setup.app;
  db = setup.db;
  db.prepare("DELETE FROM sync_logs").run();
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

describe("POST /api/sync-logs", () => {
  it("accepts a single entry", async () => {
    const res = await app.request("/api/sync-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "desktop", action: "push", detail: "ok", record_count: 1 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1 });
    expect(db.prepare("SELECT device, action, detail, record_count FROM sync_logs").get()).toEqual({
      device: "desktop",
      action: "push",
      detail: "ok",
      record_count: 1,
    });
  });

  it("accepts an array", async () => {
    const res = await app.request("/api/sync-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ action: "pull" }, { action: "push" }]),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 2 });
  });
});

describe("GET /api/sync-logs", () => {
  it("returns latest entries up to limit", async () => {
    for (let i = 0; i < 5; i++) {
      db.prepare("INSERT INTO sync_logs (device, action, record_count) VALUES (?, ?, ?)").run("test", `action-${i}`, i);
    }

    const res = await app.request("/api/sync-logs?limit=3");

    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: number; action: string }>;
    expect(body).toHaveLength(3);
    expect(body.map((entry) => entry.action)).toEqual(["action-4", "action-3", "action-2"]);
  });
});

describe("DELETE /api/sync-logs", () => {
  it("clears all logs", async () => {
    db.prepare("INSERT INTO sync_logs (action) VALUES (?)").run("push");

    const res = await app.request("/api/sync-logs", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_logs").get()).toEqual({ count: 0 });
  });
});
