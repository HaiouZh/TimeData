import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { totpCode } from "../lib/totp.js";

let db: Database.Database;

// 内存库搭法照抄 lib/totpStore.test.ts:mock connection 后动态 import,避免碰真实磁盘库。
const FIXED_NOW = 1_700_000_000_000;
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

async function buildApp() {
  // 自建两张 totp 表(与 db/schema.ts 定义一致),不依赖 schema 初始化,隔离并行改动。
  db.exec(`
    CREATE TABLE IF NOT EXISTS totp_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS totp_recovery_codes (
      code_hash TEXT PRIMARY KEY,
      used_at TEXT
    );
  `);
  const store = await import("../lib/totpStore.js");
  const { createRequireTotp } = await import("./totp.js");
  const app = new Hono();
  app.use("/api/export/*", createRequireTotp({ now: () => FIXED_NOW }));
  app.get("/api/export/full", (c) => c.json({ ok: true }));
  return { app, store };
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

describe("requireTotp", () => {
  it("未绑定时无头请求放行", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/export/full");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("已绑定 + 缺 X-TOTP-Code 头 → 401 totp_required", async () => {
    const { app, store } = await buildApp();
    store.enrollTotp(SECRET, []);
    const res = await app.request("/api/export/full");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "totp_required" });
  });

  it("已绑定 + 正确当期码放行", async () => {
    const { app, store } = await buildApp();
    store.enrollTotp(SECRET, []);
    const res = await app.request("/api/export/full", {
      headers: { "X-TOTP-Code": totpCode(SECRET, FIXED_NOW) },
    });
    expect(res.status).toBe(200);
  });

  it("已绑定 + 错码 → 401 totp_invalid", async () => {
    const { app, store } = await buildApp();
    store.enrollTotp(SECRET, []);
    // 000000 恰好等于当期码的概率极低;若撞上则说明实现坏了,直接换 999999 之类也应稳定。
    const wrong = totpCode(SECRET, FIXED_NOW) === "000000" ? "111111" : "000000";
    const res = await app.request("/api/export/full", { headers: { "X-TOTP-Code": wrong } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "totp_invalid" });
  });

  it("已绑定 + 恢复码一次性:首次放行,复用 401 totp_invalid", async () => {
    const { app, store } = await buildApp();
    store.enrollTotp(SECRET, ["aaaa-1111"]);
    const first = await app.request("/api/export/full", { headers: { "X-TOTP-Code": "aaaa-1111" } });
    expect(first.status).toBe(200);
    const replay = await app.request("/api/export/full", { headers: { "X-TOTP-Code": "aaaa-1111" } });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: "totp_invalid" });
  });
});
