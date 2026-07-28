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

/** 校验展开后的绝对路径确实落在 vaultDir 内，越界防护，日/周共用 */
function resolveInsideVault(vaultDir: string, rel: string): string {
  const abs = path.resolve(vaultDir, rel);
  const root = path.resolve(vaultDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("路径越出 vault 目录");
  return abs;
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
