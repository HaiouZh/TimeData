import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/test", "../routes/syncLog.js");
  db = setup.db;
  db.prepare("DELETE FROM api_request_logs").run();

  const { Hono } = await import("hono");
  const { requestAudit } = await import("./requestAudit.js");
  app = new Hono();
  app.use("/api/*", requestAudit());
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

function latestLog() {
  return db.prepare("SELECT * FROM api_request_logs ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
}

function logCount() {
  return (db.prepare("SELECT COUNT(*) AS c FROM api_request_logs").get() as { c: number }).c;
}

describe("requestAudit", () => {
  it("records successful API requests and strips the query string from path", async () => {
    app.get("/api/ok", (c) => {
      c.set("tokenTier", "public");
      return c.json({ ok: true });
    });

    const res = await app.request("/api/ok?token=secret", {
      headers: { "User-Agent": "Vitest", "X-TimeData-Client": "web" },
    });

    expect(res.status).toBe(200);
    expect(latestLog()).toMatchObject({
      method: "GET",
      path: "/api/ok",
      status: 200,
      outcome: "ok",
      token_tier: "public",
      user_agent: "Vitest",
      client_hint: "web",
      device_label: "web",
    });
  });

  it("records auth failures without persisting Authorization or body values", async () => {
    app.post("/api/private", (c) => {
      c.set("tokenTier", "invalid");
      return c.json({ error: "Unauthorized" }, 401);
    });

    const res = await app.request("/api/private?apiKey=query-secret", {
      method: "POST",
      headers: {
        Authorization: "Bearer header-secret",
        "Content-Type": "application/json",
        "X-Real-IP": "203.0.113.5",
      },
      body: JSON.stringify({ token: "body-secret" }),
    });

    expect(res.status).toBe(401);
    const log = latestLog();
    expect(log).toMatchObject({
      method: "POST",
      path: "/api/private",
      status: 401,
      outcome: "auth_failed",
      token_tier: "invalid",
      ip: "203.0.113.5",
    });
    expect(JSON.stringify(log)).not.toContain("header-secret");
    expect(JSON.stringify(log)).not.toContain("body-secret");
    expect(JSON.stringify(log)).not.toContain("query-secret");
  });

  it("records server error and rate limited outcomes", async () => {
    app.get("/api/error", (c) => c.json({ error: "boom" }, 500));
    app.get("/api/rate", (c) => c.json({ error: "too many" }, 429));

    expect((await app.request("/api/error")).status).toBe(500);
    expect(latestLog()).toMatchObject({ path: "/api/error", status: 500, outcome: "server_error" });

    expect((await app.request("/api/rate")).status).toBe(429);
    expect(latestLog()).toMatchObject({ path: "/api/rate", status: 429, outcome: "rate_limited" });
  });

  // 2026-07-30 生产取证：容器健康检查每 30 秒打一次 /api/health，占满了请求日志表
  // （5000 行里 4390 条 = 88%），把真正有用的日志挤到只剩 40 小时可回溯。
  it("成功的 /api/health 探活不写日志", async () => {
    app.get("/api/health", (c) => c.json({ ok: true }));

    expect((await app.request("/api/health")).status).toBe(200);

    expect(logCount()).toBe(0);
  });

  it("异常的 /api/health 仍然记录——探活挂了必须看得见", async () => {
    app.get("/api/health", (c) => c.json({ error: "db down" }, 500));

    expect((await app.request("/api/health")).status).toBe(500);

    expect(latestLog()).toMatchObject({ path: "/api/health", status: 500, outcome: "server_error" });
  });

  it("只豁免 /api/health 本身，同前缀的别的路径照常记录", async () => {
    app.get("/api/health-checks", (c) => c.json({ ok: true }));

    expect((await app.request("/api/health-checks")).status).toBe(200);

    expect(latestLog()).toMatchObject({ path: "/api/health-checks", status: 200 });
  });

  it("swallows audit write failures and warns", async () => {
    cleanupRouteTestDb(db);
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.doMock("../lib/requestLog.js", () => ({
      recordRequestLog: vi.fn(() => {
        throw new Error("db locked");
      }),
      pruneRequestLogs: vi.fn(),
    }));
    const { Hono } = await import("hono");
    const { requestAudit } = await import("./requestAudit.js");
    const failingApp = new Hono();
    failingApp.use("/api/*", requestAudit());
    failingApp.get("/api/ok", (c) => c.json({ ok: true }));

    const res = await failingApp.request("/api/ok");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith("[request-audit] write failed:", expect.any(Error));
    vi.doUnmock("../lib/requestLog.js");
  });
});
