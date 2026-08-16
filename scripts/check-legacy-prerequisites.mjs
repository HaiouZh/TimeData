import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const toPosix = (p) => p.replace(/\\/g, "/");

// 扫描根目录：client 与 shared 的生产代码（server 不扫——goals 表仍有这一列，
// packages/server/src/lib/goal-rows.ts 的 row 映射必须继续写它）。
const SCAN_DIRS = [join(ROOT, "packages", "client", "src"), join(ROOT, "packages", "shared", "src")];

// 允许清单：整个文件豁免本规则（路径相对仓库根，正斜杠）。
// 每个文件豁免都有一条理由，不允许无注释新增。
const ALLOWLIST = [
  // 读取适配层，往内存对象填派生值（读它合法，写数据库才违规）
  "packages/client/src/lib/goalPrerequisiteHydration.ts",
  // 迁移函数，唯一合法的数据库写入方（它负责清空旧字段）
  "packages/client/src/db/index.ts",
  // Zod schema 的字段定义（类型契约，不是往对象里塞值）
  "packages/shared/src/entitySchemas.ts",
];

const isTest = (rel) => /\.test\.[jt]sx?$/.test(rel);
const isTsSource = (rel) => /\.tsx?$/.test(rel);

/**
 * 单行规则判定：一行里出现 `prerequisites` 作为对象字面量的键时——
 * 注释（`//` 行首、`/*` 或 `*` 行首、上一行开着的块注释内）→ 放行（说明性文字，不是写值）；
 * 值是字面量空数组（允许尾随逗号、`as const` 断言、行尾注释与闭合分隔符）→ 放行；
 * 该行以 `;` 结尾且无对象字面量闭合 → 放行（TypeScript 类型/接口字段声明）；
 * 其余一切（`prerequisites: goal.prerequisites ?? []`、`prerequisites: someVar` 等）→ 违规。
 *
 * @param {boolean} inBlockComment 上一行以未闭合的块注释结尾（collectFindings 逐行维护）
 */
export function violatesRule(line, inBlockComment = false) {
  if (inBlockComment) return false;
  if (/^\s*\/(\/|\*)/.test(line)) return false; // `//` 或 `/*` 行首
  if (/^\s*\*/.test(line)) return false; // JSDoc/块注释续行
  const m = /prerequisites\s*:/.exec(line);
  if (!m) return false;
  const rest = line.slice(m.index + m[0].length);
  // 字面量空数组，可带 `as const` 断言、尾随逗号/闭合符与行尾注释
  if (/^\s*\[\]\s*(as\s+const\s*)?[\s,}\];)]*(\/\/[^\n]*)?\s*$/.test(rest)) return false;
  // 以 `;` 结尾的类型/接口字段声明；rest 里含 `{`/`}` 说明是内联对象语句（如 `{ prerequisites: x };`），照判违规
  if (/;+\s*$/.test(rest) && !/[{}]/.test(rest)) return false;
  return true;
}

/** 逐行维护块注释状态：返回该行结束时是否仍处于未闭合的块注释内。 */
function endsInBlockComment(line, inBlock) {
  let i = 0;
  if (inBlock) {
    const close = line.indexOf("*/");
    if (close === -1) return true;
    i = close + 2;
  }
  const open = line.indexOf("/*", i);
  if (open === -1) return false;
  const lineComment = line.indexOf("//", i);
  if (lineComment !== -1 && lineComment < open) return false; // `//` 先到 → 其余全是行注释
  return line.indexOf("*/", open + 2) === -1;
}

function walk(dir, onFile) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, onFile);
      continue;
    }
    onFile(full);
  }
}

/** 扫全树，产出违规明细（{ file: 仓库相对路径, line, message }）。不读豁免外的任何配置，纯采集。 */
export function collectFindings({ dirs = SCAN_DIRS, root = ROOT, allowlist = ALLOWLIST } = {}) {
  const findings = [];
  for (const dir of dirs) {
    walk(dir, (full) => {
      const rel = toPosix(relative(root, full));
      if (!isTsSource(rel) || isTest(rel)) return;
      if (allowlist.includes(rel)) return;
      const content = readFileSync(full, "utf8");
      let inBlockComment = false;
      content.split("\n").forEach((line, i) => {
        if (violatesRule(line, inBlockComment)) {
          findings.push({
            file: rel,
            line: i + 1,
            message: "往数据库旧字段 goal.prerequisites 写值（显式写空 `prerequisites: []` 才被允许）",
          });
        }
        inBlockComment = endsInBlockComment(line, inBlockComment);
      });
    });
  }
  return findings;
}

export function run({ dirs, root, allowlist, log = console.log, error = console.error } = {}) {
  const findings = collectFindings({ dirs, root, allowlist });
  if (findings.length > 0) {
    error(
      `✗ 旧字段回写闸（命中 ${findings.length} 处）：\n${findings
        .map((f) => `${f.file}:${f.line}  ${f.message}`)
        .join("\n")}`,
    );
    return 1;
  }
  log("✓ 旧字段 goal.prerequisites：未发现对象字面量写入（显式空数组除外）");
  return 0;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exit(run());
}
