import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeoLookup } from "./geoip.js";

let db: Database.Database;

// 内存库搭法照抄 totpStore.test.ts:mock connection 后动态 import,避免碰真实磁盘库。
type KnownIps = typeof import("./knownIps.js");

async function loadStore(): Promise<KnownIps> {
  const { initializeDatabase } = await import("../db/schema.js");
  initializeDatabase();
  return import("./knownIps.js");
}

beforeEach(() => {
  db = new Database(":memory:");
  vi.resetModules();
  vi.doMock("../db/connection.js", () => ({ getDb: () => db }));
});

afterEach(() => {
  db.close();
  vi.doUnmock("../db/connection.js");
});

const CN_MOBILE_SH: GeoLookup = { country: "中国", city: "上海", asn: 9808, asnOrg: "China Mobile" };
const CN_MOBILE_NJ: GeoLookup = { country: "中国", city: "南京", asn: 9808, asnOrg: "China Mobile" };
const DO_NO_CITY: GeoLookup = { country: "美国", city: null, asn: 14061, asnOrg: "DigitalOcean" };

function geo(value: GeoLookup | null): (ip: string) => GeoLookup | null {
  return () => value;
}

describe("knownIps 按范围收敛", () => {
  it("同运营商同城市换 IP:第二次不算新,只更新 last_seen 与 last_ip", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH))).toBe(true);
    expect(store.checkAndRecordIp("master", "203.0.113.77", "2026-07-28T01:00:00.000Z", geo(CN_MOBILE_SH))).toBe(false);

    const row = db
      .prepare("SELECT scope_key, first_seen, last_seen, last_ip, country, city, asn_org FROM known_ip_scopes WHERE token_tier = ?")
      .get("master") as {
        scope_key: string; first_seen: string; last_seen: string; last_ip: string;
        country: string; city: string; asn_org: string;
      };
    expect(row.scope_key).toBe("asn:9808|city:上海");
    expect(row.first_seen).toBe("2026-07-28T00:00:00.000Z");
    expect(row.last_seen).toBe("2026-07-28T01:00:00.000Z");
    expect(row.last_ip).toBe("203.0.113.77");
    expect(row).toMatchObject({ country: "中国", city: "上海", asn_org: "China Mobile" });
  });

  it("换城市算新范围", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH))).toBe(true);
    expect(store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T01:00:00.000Z", geo(CN_MOBILE_NJ))).toBe(true);
    const count = db.prepare("SELECT COUNT(*) as count FROM known_ip_scopes").get() as { count: number };
    expect(count.count).toBe(2);
  });

  it("城市缺失时按 asn 收敛,同 ASN 换 IP 不算新", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(DO_NO_CITY))).toBe(true);
    expect(store.checkAndRecordIp("master", "198.51.100.4", "2026-07-28T01:00:00.000Z", geo(DO_NO_CITY))).toBe(false);
    const row = db.prepare("SELECT scope_key FROM known_ip_scopes").get() as { scope_key: string };
    expect(row.scope_key).toBe("asn:14061");
  });

  it("无归属地时按 /24 收敛:末位变不算新,第三段变算新", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(null))).toBe(true);
    expect(store.checkAndRecordIp("master", "203.0.113.250", "2026-07-28T01:00:00.000Z", geo(null))).toBe(false);
    expect(store.checkAndRecordIp("master", "203.0.114.9", "2026-07-28T02:00:00.000Z", geo(null))).toBe(true);
  });

  it("tier 隔离:agent 见过的范围对 master 仍是新", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("agent", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH))).toBe(true);
    expect(store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH))).toBe(true);
  });

  it("null ip 与非法 tier 恒 false 且不记录", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", null, "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH))).toBe(false);
    for (const tier of ["public", "missing", "invalid", "unknown"]) {
      expect(store.checkAndRecordIp(tier, "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH))).toBe(false);
    }
    const count = db.prepare("SELECT COUNT(*) as count FROM known_ip_scopes").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("acknowledge 后不再出现在未确认列表,其余不受影响", async () => {
    const store = await loadStore();
    store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH));
    store.checkAndRecordIp("agent", "198.51.100.4", "2026-07-28T00:30:00.000Z", geo(DO_NO_CITY));
    expect(store.listUnacknowledgedNewIpScopes()).toHaveLength(2);

    store.acknowledgeIpScope("master", "asn:9808|city:上海");
    const remaining = store.listUnacknowledgedNewIpScopes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      tokenTier: "agent",
      scopeKey: "asn:14061",
      country: "美国",
      city: null,
      asnOrg: "DigitalOcean",
      lastIp: "198.51.100.4",
      firstSeen: "2026-07-28T00:30:00.000Z",
      lastSeen: "2026-07-28T00:30:00.000Z",
    });
  });

  it("已确认的范围再次出现仍是旧范围(不重置 acknowledged)", async () => {
    const store = await loadStore();
    store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z", geo(CN_MOBILE_SH));
    store.acknowledgeIpScope("master", "asn:9808|city:上海");
    expect(store.checkAndRecordIp("master", "203.0.113.77", "2026-07-28T02:00:00.000Z", geo(CN_MOBILE_SH))).toBe(false);
    expect(store.listUnacknowledgedNewIpScopes()).toHaveLength(0);
  });

  it("acknowledgeIpScope 对不存在的范围幂等,不抛", async () => {
    const store = await loadStore();
    expect(() => store.acknowledgeIpScope("master", "asn:99999")).not.toThrow();
  });

  it("默认不传 geoLookup 时走真实查询(测试环境无库 → 按网段收敛)", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", "203.0.113.9", "2026-07-28T00:00:00.000Z")).toBe(true);
    const row = db.prepare("SELECT scope_key FROM known_ip_scopes").get() as { scope_key: string };
    expect(row.scope_key).toBe("net:203.0.113");
  });
});
