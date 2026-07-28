import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;

// 内存库搭法照抄 db/schema.test.ts:mock connection 后动态 import,避免碰真实磁盘库。
type TotpStore = typeof import("./totpStore.js");

async function loadStore(): Promise<TotpStore> {
  const { initializeDatabase } = await import("../db/schema.js");
  initializeDatabase();
  return import("./totpStore.js");
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

describe("totpStore", () => {
  it("初始未绑定", async () => {
    const store = await loadStore();
    expect(store.isTotpEnrolled()).toBe(false);
    expect(store.getTotpSecret()).toBeNull();
  });

  it("绑定后可读且不可重复绑定", async () => {
    const store = await loadStore();
    store.enrollTotp("SECRETBASE32", ["aaaa-1111", "bbbb-2222"]);
    expect(store.isTotpEnrolled()).toBe(true);
    expect(store.getTotpSecret()).toBe("SECRETBASE32");
    expect(() => store.enrollTotp("OTHER", [])).toThrow();
  });

  it("恢复码以 sha256 哈希落库,不存明文", async () => {
    const store = await loadStore();
    store.enrollTotp("SECRETBASE32", ["aaaa-1111"]);
    const rows = db.prepare("SELECT code_hash FROM totp_recovery_codes").all() as Array<{ code_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].code_hash).not.toContain("aaaa-1111");
  });

  it("恢复码一次性:首次 true,复用 false,未知码 false", async () => {
    const store = await loadStore();
    store.enrollTotp("SECRETBASE32", ["aaaa-1111"]);
    expect(store.consumeRecoveryCode("aaaa-1111")).toBe(true);
    expect(store.consumeRecoveryCode("aaaa-1111")).toBe(false);
    expect(store.consumeRecoveryCode("zzzz-9999")).toBe(false);
  });

  it("clear 后回到未绑定,可重新绑定", async () => {
    const store = await loadStore();
    store.enrollTotp("SECRETBASE32", ["aaaa-1111"]);
    store.clearTotpEnrollment();
    expect(store.isTotpEnrolled()).toBe(false);
    store.enrollTotp("NEW", ["cccc-3333"]);
    expect(store.getTotpSecret()).toBe("NEW");
    // 旧恢复码随 clear 一并清空
    expect(store.consumeRecoveryCode("aaaa-1111")).toBe(false);
    expect(store.consumeRecoveryCode("cccc-3333")).toBe(true);
  });
});
