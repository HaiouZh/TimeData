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
      isNewIp: false,
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
      isNewIp: true,
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
        isNewIp: true,
        country: null,
        city: null,
        asnOrg: null,
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
      isNewIp: false,
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
        isNewIp: false,
      });
    }

    pruneRequestLogs({ maxAgeDays: 30, maxRows: 2 });

    expect(queryRequestLogs({ limit: 10 }).map((row) => row.path)).toEqual(["/api/3", "/api/2"]);
    vi.useRealTimers();
  });
});

describe("queryRequestLogs 归属地", () => {
  it("每行查的是自己的 IP:两行不同 IP 得到各自的归属地", async () => {
    const { queryRequestLogs, recordRequestLog } = await import("./requestLog.js");

    for (const [ip, timestamp] of [
      ["203.0.113.9", "2026-07-30T00:00:00.000Z"],
      ["198.51.100.4", "2026-07-30T01:00:00.000Z"],
    ] as const) {
      recordRequestLog({
        timestamp,
        method: "GET",
        path: "/api/entries",
        status: 200,
        outcome: "ok",
        tokenTier: "master",
        ip,
        userAgent: "Vitest",
        clientHint: "web",
        deviceLabel: null,
        durationMs: 5,
        isNewIp: false,
      });
    }

    // 桩按入参分支——常量桩会让「每行查自己的 IP」这条根本没被断言。
    const logs = queryRequestLogs({}, (ip) =>
      ip === "203.0.113.9"
        ? { country: "中国", city: "上海", cityGeonameId: 1796236, asn: 9808, asnOrg: "China Mobile" }
        : { country: "美国", city: null, cityGeonameId: null, asn: 14061, asnOrg: "DigitalOcean" },
    );

    const byIp = new Map(logs.map((log) => [log.ip, log]));
    expect(byIp.get("203.0.113.9")).toMatchObject({ country: "中国", city: "上海", asnOrg: "China Mobile" });
    expect(byIp.get("198.51.100.4")).toMatchObject({ country: "美国", city: null, asnOrg: "DigitalOcean" });
  });

  it("ip 为 null 的行不调用 geoLookup,三个字段都是 null", async () => {
    const { queryRequestLogs, recordRequestLog } = await import("./requestLog.js");

    recordRequestLog({
      timestamp: "2026-07-30T00:00:00.000Z",
      method: "GET",
      path: "/api/health",
      status: 200,
      outcome: "ok",
      tokenTier: "public",
      ip: null,
      userAgent: null,
      clientHint: "unknown",
      deviceLabel: null,
      durationMs: 1,
      isNewIp: false,
    });

    const geoLookup = vi.fn(() => ({
      country: "中国", city: "上海", cityGeonameId: 1796236, asn: 9808, asnOrg: "China Mobile",
    }));
    const logs = queryRequestLogs({}, geoLookup);

    expect(logs[0]).toMatchObject({ country: null, city: null, asnOrg: null });
    // 数调用次数才守得住 row.ip === null 那道短路:常量桩下两个分支不可区分。
    expect(geoLookup).not.toHaveBeenCalled();
  });

  it("查不到归属地时三个字段都是 null", async () => {
    const { queryRequestLogs, recordRequestLog } = await import("./requestLog.js");

    recordRequestLog({
      timestamp: "2026-07-30T00:00:00.000Z",
      method: "GET",
      path: "/api/entries",
      status: 200,
      outcome: "ok",
      tokenTier: "master",
      ip: "203.0.113.9",
      userAgent: "Vitest",
      clientHint: "web",
      deviceLabel: null,
      durationMs: 5,
      isNewIp: false,
    });

    const logs = queryRequestLogs({}, () => null);
    expect(logs[0]).toMatchObject({ country: null, city: null, asnOrg: null });
  });
});
