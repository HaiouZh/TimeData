import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { getServerConfig, setServerConfig } from "../garmin/garminConfig.js";
import { expandDiaryTemplate, isValidDiaryDate, resolveDiaryFile } from "../lib/diary-path.js";

const TEMPLATE_KEY = "diary.pathTemplate.v1";
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

diary.get("/config", (c) => c.json({ enabled: vaultDir() !== null, template: getServerConfig(TEMPLATE_KEY) ?? "" }));

diary.put("/config", async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return c.json({ error: "请求体必须是有效 JSON 对象" }, 400);
  }
  const { template } = rawBody as { template?: unknown };
  if (typeof template !== "string") return c.json({ error: "缺少 template" }, 400);
  try {
    // 用固定日期校验模板语法本身是否合法
    expandDiaryTemplate(template, "2026-01-01");
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  setServerConfig(TEMPLATE_KEY, template.trim());
  return c.json({ ok: true });
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
