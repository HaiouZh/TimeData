import path from "node:path";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDiaryDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === Number(mo) - 1 && dt.getUTCDate() === Number(d);
}

export function expandDiaryTemplate(template: string, date: string): string {
  const tpl = template.trim();
  if (!tpl) throw new Error("模板不能为空");
  if (tpl.includes("\\")) throw new Error("模板不能包含反斜杠，请用 / 分隔");
  if (tpl.startsWith("/") || /^[A-Za-z]:/.test(tpl)) throw new Error("模板必须是相对路径");
  if (tpl.split("/").some((seg) => seg === "..")) throw new Error("模板不能包含 ..");
  const unknown = tpl.match(/\{[^}]*\}/g)?.filter((p) => !["{yyyy}", "{MM}", "{dd}"].includes(p));
  if (unknown?.length) throw new Error(`未知占位符: ${unknown.join(", ")}`);
  if (!isValidDiaryDate(date)) throw new Error("日期必须是 YYYY-MM-DD");
  const [yyyy, MM, dd] = date.split("-");
  return tpl.replaceAll("{yyyy}", yyyy).replaceAll("{MM}", MM).replaceAll("{dd}", dd);
}

export function resolveDiaryFile(vaultDir: string, template: string, date: string): string {
  const rel = expandDiaryTemplate(template, date);
  const abs = path.resolve(vaultDir, rel);
  const root = path.resolve(vaultDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("路径越出 vault 目录");
  return abs;
}
