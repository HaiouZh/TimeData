import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

function syncLogRequest(path = "", init?: RequestInit) {
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


describe("上报上限：客户端常量与本路由的 schema 必须同源", () => {
  // 客户端把 detail 超长的现场直接拒收、把单批切到 100 条，两个数字都是照着本文件的 schema 写死的，
  // 而此前只有注释相认——漂了就是整批 400，open_session / scheduler_probe 会静默全丢，而报告全空
  // 会被读成「没有卡死」。这一条读客户端源码取数、再拿真实请求打本路由，两边任一改动都会红（终审 A4）。
  const clientSource = readFileSync(
    new URL("../../../client/src/lib/recovery/pendingReports.ts", import.meta.url),
    "utf8",
  );
  const constOf = (name: string): number => {
    const found = new RegExp(`export const ${name} = (\\d+);`).exec(clientSource);
    if (!found) throw new Error(`客户端 pendingReports.ts 里找不到 ${name}`);
    return Number(found[1]);
  };
  const detailMax = constOf("SYNC_LOG_DETAIL_MAX");
  const batchMax = constOf("SYNC_LOG_BATCH_MAX");

  const post = (body: unknown) =>
    syncLogRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const entry = (detail: string) => ({ action: "scheduler_probe", detail });

  it(`detail 恰好 SYNC_LOG_DETAIL_MAX 收得下，多一个字符就 400`, async () => {
    expect((await post(entry("x".repeat(detailMax)))).status).toBe(201);
    expect((await post(entry("x".repeat(detailMax + 1)))).status).toBe(400);
  });

  it(`单批恰好 SYNC_LOG_BATCH_MAX 条收得下，多一条就 400`, async () => {
    const batch = (n: number) => Array.from({ length: n }, () => entry("x"));
    expect((await post(batch(batchMax))).status).toBe(201);
    expect((await post(batch(batchMax + 1))).status).toBe(400);
  });
});
