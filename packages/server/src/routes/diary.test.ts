import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
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
    expect(await res.json()).toEqual({ enabled: true, template: "", weeklyTemplate: "", guideItems: "" });
    expect((await putConfig()).status).toBe(200);
    res = await app.request("/api/diary/config");
    expect(await res.json()).toEqual({ enabled: true, template: TPL, weeklyTemplate: "", guideItems: "" });
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

  it("损坏 JSON 返回 400", async () => {
    const res = await app.request("/api/diary/config", {
      method: "PUT",
      body: '{"template":"x\n"}',
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "请求体必须是有效 JSON 对象" });
  });
});

describe("diary config 周记模板", () => {
  it("PUT weeklyTemplate 后 GET 能读回", async () => {
    let res = await app.request("/api/diary/config");
    expect((await res.json()).weeklyTemplate).toBe("");
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ weeklyTemplate: "Reviews/{gggg}-W{ww}.md" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    res = await app.request("/api/diary/config");
    expect((await res.json()).weeklyTemplate).toBe("Reviews/{gggg}-W{ww}.md");
  });

  it("非法周记模板 400", async () => {
    const res = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ weeklyTemplate: "{yyyy}.md" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("只传 template 不动 weeklyTemplate，两键独立更新", async () => {
    await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ weeklyTemplate: "Reviews/{gggg}-W{ww}.md" }),
      headers: { "Content-Type": "application/json" },
    });
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ template: TPL }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    const res = await app.request("/api/diary/config");
    const body = await res.json();
    expect(body.template).toBe(TPL);
    expect(body.weeklyTemplate).toBe("Reviews/{gggg}-W{ww}.md");
  });

  it("空串 weeklyTemplate = 清除配置（设置页「留空 = 不显示周记」的兑现）", async () => {
    await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ weeklyTemplate: "Reviews/{gggg}-W{ww}.md" }),
      headers: { "Content-Type": "application/json" },
    });
    const cleared = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ weeklyTemplate: "" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(cleared.status).toBe(200);
    expect((await (await app.request("/api/diary/config")).json()).weeklyTemplate).toBe("");

    // 清掉之后 batch 必须回到「未配置周记」状态
    await putConfig();
    const batch = await app.request("/api/diary/batch", {
      method: "POST",
      body: JSON.stringify({ dates: [], weeks: ["2026-W28"] }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await batch.json()).weeklyConfigured).toBe(false);
  });

  it("日模板仍不允许空（没对外承诺可留空）", async () => {
    const res = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ template: "" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("两键都缺 400", async () => {
    const res = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

describe("diary batch", () => {
  const putWeeklyConfig = (weeklyTemplate: string) =>
    app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ weeklyTemplate }),
      headers: { "Content-Type": "application/json" },
    });
  const postBatch = (body: unknown) =>
    app.request("/api/diary/batch", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

  it("批量读日期与周，含存在/不存在与未配周模板", async () => {
    await putConfig();
    await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body: JSON.stringify({ content: "day1", baseMtime: null }),
      headers: { "Content-Type": "application/json" },
    });
    await app.request("/api/diary/2026-07-10", {
      method: "PUT",
      body: JSON.stringify({ content: "day2", baseMtime: null }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await postBatch({ dates: ["2026-07-09", "2026-07-10", "2026-07-11"], weeks: ["2026-W28"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dates["2026-07-09"]).toEqual({ exists: true, content: "day1" });
    expect(body.dates["2026-07-10"]).toEqual({ exists: true, content: "day2" });
    expect(body.dates["2026-07-11"]).toEqual({ exists: false, content: "" });
    expect(body.weeks["2026-W28"]).toEqual({ exists: false, content: "" });
    expect(body.weeklyConfigured).toBe(false);
  });

  it("41 项超限 400", async () => {
    await putConfig();
    const dates = Array.from({ length: 41 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")}`);
    const res = await postBatch({ dates, weeks: [] });
    expect(res.status).toBe(400);
  });

  it("非法日期 400", async () => {
    await putConfig();
    const res = await postBatch({ dates: ["2026-13-05"], weeks: [] });
    expect(res.status).toBe(400);
  });

  it("配好周模板后周记文件能读到", async () => {
    await putConfig();
    await putWeeklyConfig("Reviews/{gggg}-W{ww}.md");
    fs.mkdirSync(path.join(vault, "Reviews"), { recursive: true });
    fs.writeFileSync(path.join(vault, "Reviews", "2026-W28.md"), "week content", "utf8");
    const res = await postBatch({ dates: [], weeks: ["2026-W28"] });
    const body = await res.json();
    expect(body.weeklyConfigured).toBe(true);
    expect(body.weeks["2026-W28"]).toEqual({ exists: true, content: "week content" });
  });

  it("单个文件不存在只降级为无内容，vault 权限坏掉则整次 503（不安静地全报无内容）", async () => {
    await putConfig();
    // ENOENT：常态，降级
    const missing = await postBatch({ dates: ["2026-07-09"], weeks: [] });
    expect(missing.status).toBe(200);
    expect((await missing.json()).dates["2026-07-09"]).toEqual({ exists: false, content: "" });

    // EACCES：整个 vault 读不了，必须给信号
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    const denied = await postBatch({ dates: ["2026-07-09", "2026-07-10"], weeks: [] });
    expect(denied.status).toBe(503);
    expect((await denied.json()).error).toBe("diary-vault-not-readable");
  });

  it("vault 未挂载 503，日模板未配置 409", async () => {
    delete process.env.DIARY_VAULT_DIR;
    expect((await postBatch({ dates: [], weeks: [] })).status).toBe(503);
    process.env.DIARY_VAULT_DIR = vault;
    expect((await postBatch({ dates: [], weeks: [] })).status).toBe(409);
  });
});

describe("diary asset", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(vault, "attachments"), { recursive: true });
    fs.writeFileSync(path.join(vault, "attachments", "a.png"), Buffer.from([1, 2, 3, 4]));
  });

  it("命中返回图片字节流与正确 Content-Type", async () => {
    const res = await app.request("/api/diary/asset?path=attachments/a.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
  });

  // 注册顺序真闸：GET /asset 若被挪到 GET /:date 之后，就会被 :date 参数路由吞掉，
  // "asset" 当日期解析失败 → 400，拿不到 200 + image/png。这条比原来那条 POST /batch
  // 的 not.toBe(400) 硬得多（POST 与只注册 GET/PUT 的 /:date 本就不可能冲突）。
  it("GET /asset 注册在 /:date 之前——不被日期路由吞掉", async () => {
    const res = await app.request("/api/diary/asset?path=attachments/a.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("路径越界/非法/非白名单扩展名一律 404（与「不存在」同一口径）", async () => {
    expect((await app.request("/api/diary/asset?path=../secret.png")).status).toBe(404);
    expect((await app.request("/api/diary/asset?path=/etc/passwd")).status).toBe(404);
    expect((await app.request("/api/diary/asset?path=..%5cwin.png")).status).toBe(404);
    expect((await app.request("/api/diary/asset?path=C%3A%5Cwindows%5Cx.png")).status).toBe(404);
    // 非图片扩展名：日记正文本身也不得经 asset 接口读出
    expect((await app.request("/api/diary/asset?path=a.md")).status).toBe(404);
  });

  // 越界防护的唯一真闸：目标文件在 vault 外**确实存在**且扩展名合法。
  // 删掉 diary.ts 的形状/前缀校验后这条必红（会拿到 200 + 文件字节）；
  // 只断言 >=400 的旧写法在那种状态下仍绿（走到 readFileSync 拿 ENOENT → 404）。
  it("vault 外真实存在的 .png 也必须 404，且响应体不含其内容", async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "diary-outside-"));
    const secret = path.join(outsideDir, "secret.png");
    fs.writeFileSync(secret, "TOP-SECRET-BYTES");
    try {
      const rel = path.relative(vault, secret).split(path.sep).join("/");
      const res = await app.request(`/api/diary/asset?path=${encodeURIComponent(rel)}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("TOP-SECRET-BYTES");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("vault 内指向外部目录的 symlink/junction 不得读出 vault 外文件", async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "diary-outside-"));
    fs.writeFileSync(path.join(outsideDir, "secret.png"), "TOP-SECRET-BYTES");
    const linkPath = path.join(vault, "out");
    try {
      // Windows 上目录 junction 无需管理员权限；POSIX 用普通目录 symlink。
      fs.symlinkSync(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // 权限不足（如未开开发者模式的 Windows + 非 junction 场景）：跳过，不误报。
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }
    try {
      const res = await app.request("/api/diary/asset?path=out/secret.png");
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("TOP-SECRET-BYTES");
    } finally {
      fs.rmSync(linkPath, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("不存在 404", async () => {
    const res = await app.request("/api/diary/asset?path=none.png");
    expect(res.status).toBe(404);
  });

  it("所有类型都带 nosniff 与 CSP", async () => {
    const res = await app.request("/api/diary/asset?path=attachments/a.png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  it("非 ENOENT 的读错误不裸 500：EACCES 给 503，其余按 404", async () => {
    const eacces = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw eacces;
    });
    const denied = await app.request("/api/diary/asset?path=attachments/a.png");
    expect(denied.status).toBe(503);
    expect((await denied.json()).error).toBe("diary-vault-not-readable");

    vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("is a directory"), { code: "EISDIR" });
    });
    expect((await app.request("/api/diary/asset?path=attachments/a.png")).status).toBe(404);
  });

  it("vault 未挂载 503", async () => {
    delete process.env.DIARY_VAULT_DIR;
    const res = await app.request("/api/diary/asset?path=attachments/a.png");
    expect(res.status).toBe(503);
  });

  it("svg 用专属 Content-Type 并附 CSP 头防脚本执行", async () => {
    fs.writeFileSync(path.join(vault, "attachments", "b.svg"), "<svg></svg>");
    const res = await app.request("/api/diary/asset?path=attachments/b.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
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

  it("vault 无写权限返回可诊断的 503", async () => {
    await putConfig();
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      const error = new Error("permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    });

    const res = await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body: JSON.stringify({ content: "x", baseMtime: null }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "diary-vault-not-writable",
      message: "服务器日记 vault 无写权限，请检查挂载目录所有权",
    });
  });

  it.each([
    ["损坏 JSON", '{"content":"x\n"}'],
    ["null 请求体", "null"],
  ])("%s 返回 400", async (_label, body) => {
    await putConfig();
    const res = await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "请求体必须是有效 JSON 对象" });
  });

  it.each([
    ["字符串 baseMtime", { content: "x", baseMtime: "1" }, "baseMtime 必须是有限数字或 null"],
    ["字符串 force", { content: "x", baseMtime: null, force: "false" }, "force 必须是布尔值"],
  ])("%s 返回 400", async (_label, body, error) => {
    await putConfig();
    const res = await app.request("/api/diary/2026-07-09", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });
});

describe("diary config 存档引导", () => {
  it("PUT guideItems 后 GET 能读回，且不牵连另两字段", async () => {
    expect((await putConfig()).status).toBe(200); // 先落 template
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "回看昨日小记\n亮点&成就" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    const body = await (await app.request("/api/diary/config")).json();
    expect(body.guideItems).toBe("回看昨日小记\n亮点&成就");
    expect(body.template).toBe(TPL); // 互不牵连
  });

  it("空串 = 清除", async () => {
    await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    expect((await (await app.request("/api/diary/config")).json()).guideItems).toBe("");
  });

  it("超长 400", async () => {
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "宁".repeat(10_001) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(400);
  });

  it("恰好 10_000 字符返回 200", async () => {
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "宁".repeat(10_000) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
  });

  it("只传 guideItems 也满足「至少一个字段」", async () => {
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
  });

  it("长度上限按 trim 后计：原始超限但去掉首尾空白后 ≤10000 应保存成功", async () => {
    const put = await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "宁".repeat(9_999) + " ".repeat(10) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    expect((await (await app.request("/api/diary/config")).json()).guideItems).toBe("宁".repeat(9_999));
  });

  it("落库前整串 trim：首尾空白不入库、内部换行保留", async () => {
    await app.request("/api/diary/config", {
      method: "PUT",
      body: JSON.stringify({ guideItems: "  回看昨日小记\n亮点&成就  \n" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await (await app.request("/api/diary/config")).json()).guideItems).toBe("回看昨日小记\n亮点&成就");
  });
});
