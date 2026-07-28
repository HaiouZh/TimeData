import fs from "node:fs";
import path from "node:path";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^\d{4}-W(\d{2})$/;

export function isValidDiaryDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === Number(mo) - 1 && dt.getUTCDate() === Number(d);
}

export function isValidWeekKey(week: string): boolean {
  const m = week.match(WEEK_RE);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= 53;
}

/** 通用模板形状校验（空/反斜杠/绝对路径/盘符/`..` 段），日模板与周模板共用 */
function validateTemplateShape(template: string): string {
  const tpl = template.trim();
  if (!tpl) throw new Error("模板不能为空");
  if (tpl.includes("\\")) throw new Error("模板不能包含反斜杠，请用 / 分隔");
  if (tpl.startsWith("/") || /^[A-Za-z]:/.test(tpl)) throw new Error("模板必须是相对路径");
  if (tpl.split("/").some((seg) => seg === "..")) throw new Error("模板不能包含 ..");
  return tpl;
}

/**
 * 逐级解析符号链接 / junction，直到最深一段已存在的祖先；不存在的尾段按字面拼回。
 * 纯字符串前缀比对挡不住 vault 里指向外部的链接（链接解析发生在 readFileSync/writeFileSync 内部，
 * 早已越过闸），必须在读写前把真实路径算出来再比。
 */
export function realpathDeepest(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const parent = path.dirname(target);
    if (parent === target) return target;
    return path.join(realpathDeepest(parent), path.basename(target));
  }
}

/** realpath 后仍必须落在 vault 的 realpath 内。抛错文案与字符串层校验一致，对外不区分。 */
export function assertRealpathInsideVault(vaultDir: string, abs: string): string {
  const realRoot = realpathDeepest(path.resolve(vaultDir));
  const realAbs = realpathDeepest(abs);
  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
    throw new Error("路径越出 vault 目录");
  }
  return abs;
}

/** 校验展开后的绝对路径确实落在 vaultDir 内，越界防护，日/周共用 */
function resolveInsideVault(vaultDir: string, rel: string): string {
  const abs = path.resolve(vaultDir, rel);
  const root = path.resolve(vaultDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("路径越出 vault 目录");
  // 字符串层过了还不够：模板里任一段可能是指向 vault 外的 symlink/junction，
  // 那样 PUT /api/diary/:date 会变成对被链接目标的任意文件写。
  return assertRealpathInsideVault(vaultDir, abs);
}

export function expandDiaryTemplate(template: string, date: string): string {
  const tpl = validateTemplateShape(template);
  const unknown = tpl.match(/\{[^}]*\}/g)?.filter((p) => !["{yyyy}", "{MM}", "{dd}"].includes(p));
  if (unknown?.length) throw new Error(`未知占位符: ${unknown.join(", ")}`);
  if (!isValidDiaryDate(date)) throw new Error("日期必须是 YYYY-MM-DD");
  const [yyyy, MM, dd] = date.split("-");
  return tpl.replaceAll("{yyyy}", yyyy).replaceAll("{MM}", MM).replaceAll("{dd}", dd);
}

export function resolveDiaryFile(vaultDir: string, template: string, date: string): string {
  const rel = expandDiaryTemplate(template, date);
  return resolveInsideVault(vaultDir, rel);
}

export function expandWeeklyTemplate(template: string, week: string): string {
  const tpl = validateTemplateShape(template);
  const unknown = tpl.match(/\{[^}]*\}/g)?.filter((p) => !["{gggg}", "{ww}"].includes(p));
  if (unknown?.length) throw new Error(`未知占位符: ${unknown.join(", ")}`);
  if (!isValidWeekKey(week)) throw new Error("周号必须是 YYYY-Www");
  const [gggg, ww] = [week.slice(0, 4), week.slice(6)];
  return tpl.replaceAll("{gggg}", gggg).replaceAll("{ww}", ww);
}

export function resolveWeeklyFile(vaultDir: string, template: string, week: string): string {
  return resolveInsideVault(vaultDir, expandWeeklyTemplate(template, week));
}
