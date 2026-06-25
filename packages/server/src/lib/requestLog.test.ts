import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let db: Database.Database;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/test", "../routes/syncLog.js");
  db = setup.db;
  db.prepare("DELETE FROM api_request_logs").run();
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

describe("requestLog", () => {
  it("records rows and queries newest first with camelCase mapping", async () => {
    const { queryRequestLogs, recordRequestLog } = await import("./requestLog.js");

    recordRequestLog({
      timestamp: "2026-06-25T00:00:00.000Z",
      method: "GET",
      path: "/api/health",
      status: 200,
      outcome: "ok",
      tokenTier: "public",
      ip: null,
      userAgent: "Vitest",
      clientHint: "web",
      deviceLabel: "web",
      durationMs: 3,
    });
    recordRequestLog({
      timestamp: "2026-06-25T00:01:00.000Z",
      method: "POST",
      path: "/api/tasks",
      status: 401,
      outcome: "auth_failed",
      tokenTier: "invalid",
      ip: "203.0.113.7",
      userAgent: null,
      clientHint: "agent",
      deviceLabel: "agent",
      durationMs: 12,
    });

    expect(queryRequestLogs({ limit: 10 })).toEqual([
      {
        id: expect.any(Number),
        timestamp: "2026-06-25T00:01:00.000Z",
        method: "POST",
        path: "/api/tasks",
        status: 401,
        outcome: "auth_failed",
        tokenTier: "invalid",
        ip: "203.0.113.7",
        userAgent: null,
        clientHint: "agent",
        deviceLabel: "agent",
        durationMs: 12,
      },
      expect.objectContaining({
        timestamp: "2026-06-25T00:00:00.000Z",
        method: "GET",
        tokenTier: "public",
      }),
    ]);
  });

  it("filters by status, outcome, token tier, and client hint", async () => {
    const { queryRequestLogs, recordRequestLog } = await import("./requestLog.js");
    const base = {
      timestamp: "2026-06-25T00:00:00.000Z",
      method: "GET",
      path: "/api/health",
      ip: null,
      userAgent: null,
      deviceLabel: null,
      durationMs: 1,
    };

    recordRequestLog({ ...base, status: 200, outcome: "ok", tokenTier: "public", clientHint: "web" });
    recordRequestLog({
      ...base,
      timestamp: "2026-06-25T00:01:00.000Z",
      status: 429,
      outcome: "rate_limited",
      tokenTier: "agent",
      clientHint: "agent",
    });

    expect(queryRequestLogs({ status: 429 }).map((row) => row.status)).toEqual([429]);
    expect(queryRequestLogs({ outcome: "rate_limited" }).map((row) => row.outcome)).toEqual(["rate_limited"]);
    expect(queryRequestLogs({ tokenTier: "agent" }).map((row) => row.tokenTier)).toEqual(["agent"]);
    expect(queryRequestLogs({ clientHint: "web" }).map((row) => row.clientHint)).toEqual(["web"]);
  });

  it("prunes by max age and max rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));
    const { pruneRequestLogs, queryRequestLogs, recordRequestLog } = await import("./requestLog.js");

    for (const [index, timestamp] of [
      "2026-05-01T00:00:00.000Z",
      "2026-06-25T00:00:00.000Z",
      "2026-06-25T00:01:00.000Z",
      "2026-06-25T00:02:00.000Z",
    ].entries()) {
      recordRequestLog({
        timestamp,
        method: "GET",
        path: `/api/${index}`,
        status: 200,
        outcome: "ok",
        tokenTier: "master",
        ip: null,
        userAgent: null,
        clientHint: "unknown",
        deviceLabel: null,
        durationMs: index,
      });
    }

    pruneRequestLogs({ maxAgeDays: 30, maxRows: 2 });

    expect(queryRequestLogs({ limit: 10 }).map((row) => row.path)).toEqual(["/api/3", "/api/2"]);
    vi.useRealTimers();
  });
});
