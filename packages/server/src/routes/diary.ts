import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { getServerConfig, setServerConfig } from "../garmin/garminConfig.js";
import {
  assertRealpathInsideVault,
  expandDiaryTemplate,
  expandWeeklyTemplate,
  isValidDiaryDate,
  isValidWeekKey,
  resolveDiaryFile,
  resolveWeeklyFile,
} from "../lib/diary-path.js";

const TEMPLATE_KEY = "diary.pathTemplate.v1";
const WEEKLY_TEMPLATE_KEY = "diary.weeklyPathTemplate.v1";
const diary = new Hono();

const vaultDir = () => process.env.DIARY_VAULT_DIR?.trim() || null;

function vaultWriteError(err: unknown): Response | null {
  const code = (err as NodeJS.ErrnoException).code;
  if (!code || !["EACCES", "EPERM", "EROFS"].includes(code)) return null;
  return Response.json(
    {
      error: "diary-vault-not-writable",
      message: "服务器日记 vault 无写权限，请检查挂载目录所有权",
    },
    { status: 503 },
  );
}

/** 读路径的权限类错误：与 vaultWriteError 同款处理，不裸 500。 */
function vaultReadError(err: unknown): Response | null {
  const code = (err as NodeJS.ErrnoException).code;
  if (!code || !["EACCES", "EPERM"].includes(code)) return null;
  return Response.json(
    {
      error: "diary-vault-not-readable",
      message: "服务器日记 vault 无读权限，请检查挂载目录所有权",
    },
    { status: 503 },
  );
}

diary.get("/config", (c) =>
  c.json({
    enabled: vaultDir() !== null,
    template: getServerConfig(TEMPLATE_KEY) ?? "",
    weeklyTemplate: getServerConfig(WEEKLY_TEMPLATE_KEY) ?? "",
  }),
);

diary.put("/config", async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return c.json({ error: "请求体必须是有效 JSON 对象" }, 400);
  }
  const { template, weeklyTemplate } = rawBody as { template?: unknown; weeklyTemplate?: unknown };
  if (typeof template !== "string" && typeof weeklyTemplate !== "string") {
    return c.json({ error: "缺少 template 或 weeklyTemplate" }, 400);
  }
  if (typeof template === "string") {
    try {
      // 用固定日期校验模板语法本身是否合法
      expandDiaryTemplate(template, "2026-01-01");
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }
  // 空串 = 清除周记配置（设置页文案「留空 = 回顾页周览不显示周记」的兑现），跳过语法校验。
  if (typeof weeklyTemplate === "string" && weeklyTemplate.trim() !== "") {
    try {
      // 用固定周号校验周记模板语法本身是否合法
      expandWeeklyTemplate(weeklyTemplate, "2026-W01");
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }
  if (typeof template === "string") setServerConfig(TEMPLATE_KEY, template.trim());
  if (typeof weeklyTemplate === "string") setServerConfig(WEEKLY_TEMPLATE_KEY, weeklyTemplate.trim());
  return c.json({ ok: true });
});

const ASSET_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

// 注意：GET /asset 必须注册在 GET /:date 之前，否则会被 :date 参数路由吞掉
// （/batch 是 POST，与只注册了 GET/PUT 的 /:date 天然不冲突，顺序对它不构成风险）。
diary.get("/asset", (c) => {
  // 对外一律 404：不区分「非法路径」「非白名单扩展名」「文件不存在」，不给探测者任何信号（spec 口径）。
  const notFound = () => c.json({ error: "not-found" }, 404);
  const rel = c.req.query("path") ?? "";
  const ext = rel.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext || !(ext in ASSET_MIME)) return notFound();
  if (rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.split("/").some((s) => s === "..")) {
    return notFound();
  }
  const root = vaultDir();
  if (!root) return c.json({ error: "diary-disabled" }, 503);
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return notFound();
  // 字符串层比对挡不住 vault 内指向外部的 symlink/junction（链接在 readFileSync 内部才解析）。
  try {
    assertRealpathInsideVault(root, abs);
  } catch {
    return notFound();
  }
  try {
    const buf = fs.readFileSync(abs);
    const headers: Record<string, string> = {
      "Content-Type": ASSET_MIME[ext],
      "Cache-Control": "private, max-age=3600",
      // Content-Type 完全由用户可控的扩展名决定，与实际字节无关：禁嗅探 + 全类型 CSP 兜底。
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    };
    return c.body(new Uint8Array(buf), 200, headers);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return notFound();
    const response = vaultReadError(err);
    if (response) return response;
    // EISDIR / EINVAL 等（vault 里同名目录、Windows 下路径含 ?）不该裸 500 暴路径信息。
    return notFound();
  }
});

diary.post("/batch", async (c) => {
  const raw: unknown = await c.req.json().catch(() => null);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return c.json({ error: "请求体必须是有效 JSON 对象" }, 400);
  }
  const { dates = [], weeks = [] } = raw as { dates?: unknown; weeks?: unknown };
  if (!Array.isArray(dates) || !Array.isArray(weeks)) return c.json({ error: "dates/weeks 必须是数组" }, 400);
  if (dates.length + weeks.length > 40) return c.json({ error: "单次最多 40 项" }, 400);
  if (!dates.every((d) => typeof d === "string" && isValidDiaryDate(d))) {
    return c.json({ error: "日期必须是 YYYY-MM-DD" }, 400);
  }
  if (!weeks.every((w) => typeof w === "string" && isValidWeekKey(w))) {
    return c.json({ error: "周号必须是 YYYY-Www" }, 400);
  }
  const root = vaultDir();
  if (!root) return c.json({ error: "diary-disabled" }, 503);
  const template = getServerConfig(TEMPLATE_KEY);
  if (!template) return c.json({ error: "diary-no-template" }, 409);
  const weeklyTemplate = getServerConfig(WEEKLY_TEMPLATE_KEY) || null;

  // 批量读是「尽力而为」：单个文件的 ENOENT/EISDIR/权限问题不该掀掉整次请求，一律当「无内容」。
  const readOne = (file: string) => {
    try {
      return { exists: true, content: fs.readFileSync(file, "utf8") };
    } catch {
      return { exists: false, content: "" };
    }
  };
  // 路径解析本身也可能抛（模板越界 / 某段是指向 vault 外的 symlink），同样降级为「无内容」。
  const readResolved = (resolve: () => string) => {
    try {
      return readOne(resolve());
    } catch {
      return { exists: false, content: "" };
    }
  };
  const dateMap: Record<string, { exists: boolean; content: string }> = {};
  for (const d of dates as string[]) dateMap[d] = readResolved(() => resolveDiaryFile(root, template, d));
  const weekMap: Record<string, { exists: boolean; content: string }> = {};
  for (const w of weeks as string[]) {
    weekMap[w] = weeklyTemplate
      ? readResolved(() => resolveWeeklyFile(root, weeklyTemplate, w))
      : { exists: false, content: "" };
  }
  return c.json({ dates: dateMap, weeks: weekMap, weeklyConfigured: weeklyTemplate !== null });
});

/** 解析目标文件路径；失败时返回可直接返回给客户端的错误响应。 */
function resolveTargetFile(date: string): { file: string } | { err: Response } {
  if (!isValidDiaryDate(date)) {
    return { err: Response.json({ error: "日期必须是 YYYY-MM-DD" }, { status: 400 }) };
  }
  const root = vaultDir();
  if (!root) {
    return { err: Response.json({ error: "diary-disabled" }, { status: 503 }) };
  }
  const template = getServerConfig(TEMPLATE_KEY);
  if (!template) {
    return { err: Response.json({ error: "diary-no-template" }, { status: 409 }) };
  }
  try {
    return { file: resolveDiaryFile(root, template, date) };
  } catch (err) {
    return { err: Response.json({ error: (err as Error).message }, { status: 400 }) };
  }
}

diary.get("/:date", (c) => {
  const r = resolveTargetFile(c.req.param("date"));
  if ("err" in r) return r.err;
  try {
    const stat = fs.statSync(r.file);
    return c.json({ content: fs.readFileSync(r.file, "utf8"), mtime: Math.floor(stat.mtimeMs) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return c.json({ content: "", mtime: null });
    throw err;
  }
});

diary.put("/:date", async (c) => {
  const r = resolveTargetFile(c.req.param("date"));
  if ("err" in r) return r.err;
  const rawBody: unknown = await c.req.json().catch(() => null);
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return c.json({ error: "请求体必须是有效 JSON 对象" }, 400);
  }
  const body = rawBody as { content?: unknown; baseMtime?: number | null; force?: boolean };
  if (typeof body.content !== "string") return c.json({ error: "缺少 content" }, 400);
  if (
    body.baseMtime !== undefined &&
    body.baseMtime !== null &&
    (typeof body.baseMtime !== "number" || !Number.isFinite(body.baseMtime))
  ) {
    return c.json({ error: "baseMtime 必须是有限数字或 null" }, 400);
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return c.json({ error: "force 必须是布尔值" }, 400);
  }

  let current: number | null = null;
  try {
    current = Math.floor(fs.statSync(r.file).mtimeMs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const response = vaultWriteError(err);
      if (response) return response;
      throw err;
    }
  }
  if (!body.force && current !== (body.baseMtime ?? null)) {
    return c.json({ error: "diary-conflict", mtime: current }, 409);
  }

  try {
    fs.mkdirSync(path.dirname(r.file), { recursive: true });
    fs.writeFileSync(r.file, body.content, "utf8");
    return c.json({ mtime: Math.floor(fs.statSync(r.file).mtimeMs) });
  } catch (err) {
    const response = vaultWriteError(err);
    if (response) return response;
    throw err;
  }
});

export default diary;
