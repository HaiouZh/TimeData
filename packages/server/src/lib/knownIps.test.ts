import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("knownIps", () => {
  it("首见返回 true,再见返回 false 且更新 last_seen", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", "1.2.3.4", "2026-07-28T00:00:00.000Z")).toBe(true);
    expect(store.checkAndRecordIp("master", "1.2.3.4", "2026-07-28T01:00:00.000Z")).toBe(false);
    const row = db
      .prepare("SELECT first_seen, last_seen FROM known_ips WHERE token_tier = ? AND ip = ?")
      .get("master", "1.2.3.4") as { first_seen: string; last_seen: string };
    expect(row.first_seen).toBe("2026-07-28T00:00:00.000Z");
    expect(row.last_seen).toBe("2026-07-28T01:00:00.000Z");
  });

  it("tier 隔离:agent 见过的 IP 对 master 仍是新", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("agent", "5.6.7.8", "2026-07-28T00:00:00.000Z")).toBe(true);
    expect(store.checkAndRecordIp("master", "5.6.7.8", "2026-07-28T00:00:00.000Z")).toBe(true);
  });

  it("null ip 与非法 tier 恒 false 且不记录", async () => {
    const store = await loadStore();
    expect(store.checkAndRecordIp("master", null, "2026-07-28T00:00:00.000Z")).toBe(false);
    for (const tier of ["public", "missing", "invalid", "unknown"]) {
      expect(store.checkAndRecordIp(tier, "9.9.9.9", "2026-07-28T00:00:00.000Z")).toBe(false);
    }
    const count = db.prepare("SELECT COUNT(*) as count FROM known_ips").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("acknowledge 后不再出现在未确认列表", async () => {
    const store = await loadStore();
    store.checkAndRecordIp("master", "1.2.3.4", "2026-07-28T00:00:00.000Z");
    store.checkAndRecordIp("agent", "5.6.7.8", "2026-07-28T00:30:00.000Z");
    expect(store.listUnacknowledgedNewIps()).toHaveLength(2);
    store.acknowledgeIp("master", "1.2.3.4");
    const remaining = store.listUnacknowledgedNewIps();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      tokenTier: "agent",
      ip: "5.6.7.8",
      firstSeen: "2026-07-28T00:30:00.000Z",
      lastSeen: "2026-07-28T00:30:00.000Z",
    });
  });

  it("已确认的 IP 再次出现仍是旧 IP(不重置 acknowledged)", async () => {
    const store = await loadStore();
    store.checkAndRecordIp("master", "1.2.3.4", "2026-07-28T00:00:00.000Z");
    store.acknowledgeIp("master", "1.2.3.4");
    expect(store.checkAndRecordIp("master", "1.2.3.4", "2026-07-28T02:00:00.000Z")).toBe(false);
    expect(store.listUnacknowledgedNewIps()).toHaveLength(0);
  });
});
