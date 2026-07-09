import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;
let vault: string;

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/diary", "../routes/diary.js");
  app = setup.app;
  db = setup.db;
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "diary-vault-"));
  process.env.DIARY_VAULT_DIR = vault;
});

afterEach(() => {
  delete process.env.DIARY_VAULT_DIR;
  fs.rmSync(vault, { recursive: true, force: true });
  cleanupRouteTestDb(db);
});

const TPL = "日记_{yyyy}/Day/{yyyy}年{MM}月/{yyyy}-{MM}-{dd}.md";
const putConfig = () =>
  app.request("/api/diary/config", {
    method: "PUT",
    body: JSON.stringify({ template: TPL }),
    headers: { "Content-Type": "application/json" },
  });

describe("diary config", () => {
  it("默认空模板，保存后可读回", async () => {
    let res = await app.request("/api/diary/config");
    expect(await res.json()).toEqual({ enabled: true, template: "" });
    expect((await putConfig()).status).toBe(200);
    res = await app.request("/api/diary/config");
    expect(await res.json()).toEqual({ enabled: true, template: TPL });
  });

  it("非法模板 400", async () => {
    const res = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ template: "../x/{yyyy}.md" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("未挂载 vault 时 enabled=false", async () => {
    delete process.env.DIARY_VAULT_DIR;
    const res = await app.request("/api/diary/config");
    expect((await res.json()).enabled).toBe(false);
  });
});

describe("diary read/write", () => {
  it("文件不存在返回空内容", async () => {
    await putConfig();
    const res = await app.request("/api/diary/2026-07-09");
    expect(await res.json()).toEqual({ content: "", mtime: null });
  });

  it("首次保存自动建目录，读回一致", async () => {
    await putConfig();
    const put = await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body: JSON.stringify({ content: "# 今天\n1. 事", baseMtime: null }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    const { mtime } = await put.json();
    expect(typeof mtime).toBe("number");
    const file = path.join(vault, "日记_2026", "Day", "2026年07月", "2026-07-09.md");
    expect(fs.readFileSync(file, "utf8")).toBe("# 今天\n1. 事");
    const res = await app.request("/api/diary/2026-07-09");
    expect(await res.json()).toEqual({ content: "# 今天\n1. 事", mtime });
  });

  it("baseMtime 不一致返回 409，force 可覆盖", async () => {
    await putConfig();
    const first = await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body: JSON.stringify({ content: "v1", baseMtime: null }),
      headers: { "Content-Type": "application/json" },
    });
    const { mtime } = await first.json();
    const stale = await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body: JSON.stringify({ content: "v2", baseMtime: mtime - 1000 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("diary-conflict");
    const forced = await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body: JSON.stringify({ content: "v2", baseMtime: null, force: true }),
      headers: { "Content-Type": "application/json" },
    });
    expect(forced.status).toBe(200);
  });

  it("非法日期 400，未启用 503", async () => {
    await putConfig();
    expect((await app.request("/api/diary/2026-2-30")).status).toBe(400);
    delete process.env.DIARY_VAULT_DIR;
    expect((await app.request("/api/diary/2026-07-09")).status).toBe(503);
  });

  it("未配置模板返回 409 diary-no-template", async () => {
    const res = await app.request("/api/diary/2026-07-09");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("diary-no-template");
  });
});
