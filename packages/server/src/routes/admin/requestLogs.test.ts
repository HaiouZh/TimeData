import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/admin/request-logs", "../routes/admin/requestLogs.js");
  app = setup.app;
  db = setup.db;
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

function seedKnownIpScope(overrides: Partial<{
  tokenTier: string;
  scopeKey: string;
  country: string | null;
  city: string | null;
  asnOrg: string | null;
  lastIp: string | null;
  firstSeen: string;
  lastSeen: string;
  acknowledged: boolean;
}> = {}): void {
  db.prepare(`
    INSERT INTO known_ip_scopes
      (token_tier, scope_key, country, city, asn_org, last_ip, first_seen, last_seen, acknowledged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.tokenTier ?? "master",
    overrides.scopeKey ?? "asn:9808|city:上海",
    overrides.country ?? "中国",
    overrides.city ?? "上海",
    overrides.asnOrg ?? "China Mobile",
    overrides.lastIp ?? "203.0.113.1",
    overrides.firstSeen ?? "2026-07-28T08:00:00.000Z",
    overrides.lastSeen ?? "2026-07-28T09:00:00.000Z",
    overrides.acknowledged ? 1 : 0,
  );
}

function seedRequestLog(overrides: Partial<{ ip: string; isNewIp: boolean }> = {}): void {
  db.prepare(`
    INSERT INTO api_request_logs (
      timestamp, method, path, status, outcome, token_tier, ip,
      user_agent, client_hint, device_label, duration_ms, is_new_ip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "2026-07-28T09:00:00.000Z",
    "GET",
    "/api/entries",
    200,
    "ok",
    "master",
    overrides.ip ?? "203.0.113.1",
    "Vitest",
    "web",
    null,
    5,
    overrides.isNewIp ? 1 : 0,
  );
}

describe("GET /api/admin/request-logs/new-ips", () => {
  it("只返回未确认的新来源范围,带归属地与最近 IP", async () => {
    seedKnownIpScope({ tokenTier: "master", scopeKey: "asn:9808|city:上海", acknowledged: false });
    seedKnownIpScope({ tokenTier: "agent", scopeKey: "asn:14061", acknowledged: true });

    const res = await app.request("/api/admin/request-logs/new-ips");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      newIps: [
        {
          tokenTier: "master",
          scopeKey: "asn:9808|city:上海",
          country: "中国",
          city: "上海",
          asnOrg: "China Mobile",
          lastIp: "203.0.113.1",
          firstSeen: "2026-07-28T08:00:00.000Z",
          lastSeen: "2026-07-28T09:00:00.000Z",
        },
      ],
    });
  });

  it("无未确认记录时返回空列表", async () => {
    const res = await app.request("/api/admin/request-logs/new-ips");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newIps: [] });
  });
});

describe("POST /api/admin/request-logs/new-ips/acknowledge", () => {
  it("按 scopeKey 确认后从未确认列表消失,其余不受影响", async () => {
    seedKnownIpScope({ tokenTier: "master", scopeKey: "asn:9808|city:上海" });
    seedKnownIpScope({ tokenTier: "agent", scopeKey: "asn:14061", firstSeen: "2026-07-28T07:00:00.000Z" });

    const ackRes = await app.request("/api/admin/request-logs/new-ips/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenTier: "master", scopeKey: "asn:9808|city:上海" }),
    });
    expect(ackRes.status).toBe(200);
    expect(await ackRes.json()).toEqual({ ok: true });

    const listRes = await app.request("/api/admin/request-logs/new-ips");
    const body = (await listRes.json()) as { newIps: Array<{ tokenTier: string; scopeKey: string }> };
    expect(body.newIps).toEqual([
      expect.objectContaining({ tokenTier: "agent", scopeKey: "asn:14061" }),
    ]);
  });

  it("缺 scopeKey 返回 400", async () => {
    const res = await app.request("/api/admin/request-logs/new-ips/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenTier: "master" }),
    });
    expect(res.status).toBe(400);
  });

  it("旧的 ip 字段形状被拒(strict),不会静默当成确认成功", async () => {
    const res = await app.request("/api/admin/request-logs/new-ips/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenTier: "master", ip: "203.0.113.1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/request-logs 行 isNewIp 映射", () => {
  it("is_new_ip 列正确映射为布尔", async () => {
    seedRequestLog({ ip: "203.0.113.9", isNewIp: true });
    seedRequestLog({ ip: "127.0.0.1", isNewIp: false });

    const res = await app.request("/api/admin/request-logs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logs: Array<{ ip: string | null; isNewIp: boolean }> };
    expect(body.logs).toHaveLength(2);
    const byIp = new Map(body.logs.map((log) => [log.ip, log.isNewIp]));
    expect(byIp.get("203.0.113.9")).toBe(true);
    expect(byIp.get("127.0.0.1")).toBe(false);
  });

  it("测试环境无 mmdb 时归属地字段为 null,不影响日志返回", async () => {
    seedRequestLog({ ip: "203.0.113.9", isNewIp: false });

    const res = await app.request("/api/admin/request-logs");
    const body = (await res.json()) as { logs: Array<{ country: string | null; city: string | null; asnOrg: string | null }> };
    expect(body.logs[0]).toMatchObject({ country: null, city: null, asnOrg: null });
  });
});
