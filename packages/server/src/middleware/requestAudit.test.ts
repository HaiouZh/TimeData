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
