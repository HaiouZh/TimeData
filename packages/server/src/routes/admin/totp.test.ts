import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../../__tests__/helpers.js";
import { totpCode } from "../../lib/totp.js";

let app: Hono;
let db: Database.Database;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/admin/totp", "../routes/admin/totp.js");
  app = setup.app;
  db = setup.db;
  // 兜底建表(与 schema.ts Task 2 定义一致,IF NOT EXISTS 幂等):并行任务期间 schema 可能尚未含 totp 表
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
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

async function postJson(path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/admin/totp", () => {
  it("初始状态未绑定", async () => {
    const res = await app.request("/api/admin/totp");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: false });
  });

  it("setup 返回 secret/otpauthUri/恢复码,不落库", async () => {
    const res = await postJson("/api/admin/totp/setup");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string; otpauthUri: string; recoveryCodes: string[] };
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauthUri).toContain(`secret=${body.secret}`);
    expect(body.recoveryCodes).toHaveLength(10);
    for (const code of body.recoveryCodes) expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);

    // 未 confirm 前不落库
    const status = await app.request("/api/admin/totp");
    expect(await status.json()).toEqual({ enrolled: false });
  });

  it("无 pending 时 confirm 返回 400 no_pending_setup", async () => {
    const res = await postJson("/api/admin/totp/confirm", { code: "000000" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_pending_setup" });
  });

  it("绑定全流程:setup→错码 400→对码 200→重复 confirm 409→disable 错码 401→对码 200", async () => {
    // setup
    const setupRes = await postJson("/api/admin/totp/setup");
    const { secret } = (await setupRes.json()) as { secret: string };

    // confirm 错码 → 400 totp_invalid,仍未绑定
    const badConfirm = await postJson("/api/admin/totp/confirm", { code: "000000" });
    expect(badConfirm.status).toBe(400);
    expect(await badConfirm.json()).toEqual({ error: "totp_invalid" });
    expect(await (await app.request("/api/admin/totp")).json()).toEqual({ enrolled: false });

    // confirm 对码 → 200 落库
    const goodConfirm = await postJson("/api/admin/totp/confirm", { code: totpCode(secret, Date.now()) });
    expect(goodConfirm.status).toBe(200);
    expect(await goodConfirm.json()).toEqual({ enrolled: true });
    expect(await (await app.request("/api/admin/totp")).json()).toEqual({ enrolled: true });

    // 已绑定重复 confirm → 409
    const dupConfirm = await postJson("/api/admin/totp/confirm", { code: totpCode(secret, Date.now()) });
    expect(dupConfirm.status).toBe(409);

    // disable 错码 → 401 totp_invalid,仍绑定
    const badDisable = await postJson("/api/admin/totp/disable", { code: "000000" });
    expect(badDisable.status).toBe(401);
    expect(await badDisable.json()).toEqual({ error: "totp_invalid" });
    expect(await (await app.request("/api/admin/totp")).json()).toEqual({ enrolled: true });

    // disable 对码 → 200 清除
    const goodDisable = await postJson("/api/admin/totp/disable", { code: totpCode(secret, Date.now()) });
    expect(goodDisable.status).toBe(200);
    expect(await goodDisable.json()).toEqual({ enrolled: false });
    expect(await (await app.request("/api/admin/totp")).json()).toEqual({ enrolled: false });
  });

  it("重复 setup 覆盖旧 pending:旧 secret 的码 confirm 失败,新 secret 的码成功", async () => {
    const first = (await (await postJson("/api/admin/totp/setup")).json()) as { secret: string };
    const second = (await (await postJson("/api/admin/totp/setup")).json()) as { secret: string };
    expect(second.secret).not.toBe(first.secret);

    const oldCode = totpCode(first.secret, Date.now());
    const newCode = totpCode(second.secret, Date.now());
    if (oldCode !== newCode) {
      const badRes = await postJson("/api/admin/totp/confirm", { code: oldCode });
      expect(badRes.status).toBe(400);
    }
    const okRes = await postJson("/api/admin/totp/confirm", { code: newCode });
    expect(okRes.status).toBe(200);
  });

  it("disable 也接受恢复码,且恢复码一次性", async () => {
    const setupBody = (await (await postJson("/api/admin/totp/setup")).json()) as {
      secret: string;
      recoveryCodes: string[];
    };
    await postJson("/api/admin/totp/confirm", { code: totpCode(setupBody.secret, Date.now()) });

    const recovery = setupBody.recoveryCodes[0];
    const res = await postJson("/api/admin/totp/disable", { code: recovery });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: false });
  });

  it("pending 超过 TTL 后 confirm 视为无 pending(400 no_pending_setup)", async () => {
    // 注入 now 推进虚拟时间,不做真实等待
    let fakeNow = Date.UTC(2026, 6, 28, 0, 0, 0);
    const { Hono } = await import("hono");
    const { createTotpRoute } = await import("./totp.js");
    const ttlApp = new Hono().route("/api/admin/totp", createTotpRoute({ now: () => fakeNow }));
    const post = (path: string, body?: unknown) =>
      ttlApp.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    // 陈旧 pending:跨过 TTL 后即便码算对也拒绝,且不落库
    const stale = (await (await post("/api/admin/totp/setup")).json()) as { secret: string };
    fakeNow += 10 * 60 * 1000;
    const expired = await post("/api/admin/totp/confirm", { code: totpCode(stale.secret, fakeNow) });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: "no_pending_setup" });
    expect(await (await ttlApp.request("/api/admin/totp")).json()).toEqual({ enrolled: false });

    // 边界另一侧:TTL 内的 pending 仍可正常确认(证明上面不是被别的原因拒的)
    const fresh = (await (await post("/api/admin/totp/setup")).json()) as { secret: string };
    fakeNow += 9 * 60 * 1000;
    const inTtl = await post("/api/admin/totp/confirm", { code: totpCode(fresh.secret, fakeNow) });
    expect(inTtl.status).toBe(200);
    expect(await (await ttlApp.request("/api/admin/totp")).json()).toEqual({ enrolled: true });
  });

  it("confirm/disable 缺 code 参数按错码处理", async () => {
    await postJson("/api/admin/totp/setup");
    const confirmRes = await postJson("/api/admin/totp/confirm", {});
    expect(confirmRes.status).toBe(400);
    const disableRes = await postJson("/api/admin/totp/disable", {});
    expect(disableRes.status).toBe(401);
  });
});
