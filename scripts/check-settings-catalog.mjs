// 设置键登记对账：client 与 shared 里 `= "<key>"` 定义的设置键常量，必须与
// docs/evergreen/categories-settings/settings-catalog.md 登记的内联代码键双向一致。
// 双向 = 代码新增/退役键都要同步文档；只扫一边会漏掉「文档过期没人改」那半边。
// shared 必须一起扫：track.actionTags.v1/v2 的正本在 shared/src/trackBoardSignals.ts、
// client 只是 re-export，只扫 client 会把这两个真键误报成「文档有、代码无」。
// 豁免写在 scripts/settings-catalog-allowlist.json（字段结构照 design-language-allowlist.json）。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = [join(ROOT, "packages", "client", "src"), join(ROOT, "packages", "shared", "src")];
const CATALOG_DOC = join(ROOT, "docs", "evergreen", "categories-settings", "settings-catalog.md");
const ALLOWLIST_PATH = join(ROOT, "scripts", "settings-catalog-allowlist.json");
const USAGE = `用法：node scripts/check-settings-catalog.mjs [--help]

对账 packages/{client,shared}/src 里定义的设置键常量与
docs/evergreen/categories-settings/settings-catalog.md 的登记：
  - 代码有、文档无 → error（手抄清单漂移，补登记或说明为何不该登记）
  - 文档有、代码无 → error（键已退役就删掉登记，或补一条豁免）
豁免写在 scripts/settings-catalog-allowlist.json（字段结构照 design-language-allowlist.json）。
退出码：有 error 退 1，否则 0。`;

// 键形态：小写开头的点分段 + 结尾 .v<数字>（如 nav.visibleTabs.v1）。
const SETTING_KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+\.v\d+$/;
// 代码侧抓 `= "<key>"` 字符串字面量（键的导出常量形态）。
const KEY_ASSIGN_RE = /= "([^"]+)"/g;
// 文档侧抓反引号行内代码（settings-catalog.md 的 key 全表用行内代码登记键）。
const INLINE_CODE_RE = /`([^`]+)`/g;

const LEGAL_RULE_IDS = new Set(["key-not-in-doc", "key-not-in-code"]);

function normalizePath(file) {
  return file.replace(/\\/g, "/");
}

/** 是否参与扫描：.ts/.tsx 且排除测试文件（测试里的键字面量是断言，不是定义）。 */
export function isScannableFile(name) {
  return /\.(?:ts|tsx)$/.test(name) && !/\.test\.(?:ts|tsx)$/.test(name);
}

/** 扫单个源码文件的文本，返回 [{key, file, line}]，只收 `= "<key>"` 且键形态合法者。 */
export function scanCodeText(text, file) {
  const hits = [];
  KEY_ASSIGN_RE.lastIndex = 0;
  let match = KEY_ASSIGN_RE.exec(text);
  while (match !== null) {
    if (SETTING_KEY_RE.test(match[1])) {
      const line = text.slice(0, match.index).split("\n").length;
      hits.push({ key: match[1], file, line });
    }
    match = KEY_ASSIGN_RE.exec(text);
  }
  return hits;
}

/** 扫文档文本，返回去重后的键集合，只收行内代码且键形态合法者。 */
export function scanDocText(text) {
  const keys = new Set();
  INLINE_CODE_RE.lastIndex = 0;
  let match = INLINE_CODE_RE.exec(text);
  while (match !== null) {
    if (SETTING_KEY_RE.test(match[1])) keys.add(match[1]);
    match = INLINE_CODE_RE.exec(text);
  }
  return [...keys];
}

function allowlistKey({ rule, lineText }) {
  return `${rule}:${lineText}`;
}

export function loadAllowlist(raw = undefined) {
  const source =
    raw ?? (existsSync(ALLOWLIST_PATH) ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) : { entries: [] });
  if (source.version !== undefined && source.version !== 1) {
    throw new Error(`scripts/settings-catalog-allowlist.json: unsupported version ${source.version}`);
  }
  const entries = source.entries ?? [];
  if (!Array.isArray(entries)) {
    throw new Error("scripts/settings-catalog-allowlist.json: entries must be an array");
  }
  const counts = new Map();
  entries.forEach((entry, index) => {
    for (const field of ["file", "rule", "lineText", "reason", "ownerBatch", "removeBy"]) {
      if (!entry[field]) {
        throw new Error(`scripts/settings-catalog-allowlist.json: entries[${index}] missing ${field}`);
      }
    }
    if (!LEGAL_RULE_IDS.has(entry.rule)) {
      throw new Error(`scripts/settings-catalog-allowlist.json: entries[${index}] unknown rule ${entry.rule}`);
    }
    if (!SETTING_KEY_RE.test(entry.lineText)) {
      throw new Error(`scripts/settings-catalog-allowlist.json: entries[${index}] invalid key ${entry.lineText}`);
    }
    const key = allowlistKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return { entries, counts, usedCounts: new Map() };
}

export function isAllowed(rule, key, allowlist) {
  const keyName = allowlistKey({ rule, lineText: key });
  const allowedCount = allowlist.counts.get(keyName) ?? 0;
  const usedCount = allowlist.usedCounts.get(keyName) ?? 0;
  if (usedCount >= allowedCount) return false;
  allowlist.usedCounts.set(keyName, usedCount + 1);
  return true;
}

/**
 * 双向对账。codeKeys: [{key, file, line}]；docKeys: [key]。
 * 返回 {errors: [string], stale: [allowlist 条目]}。
 */
export function reconcile(codeKeys, docKeys, allowlist) {
  const errors = [];
  // 同一键可能在多处定义，保留第一处即可（报错给路径）。
  const codeByKey = new Map();
  for (const hit of codeKeys) {
    if (!codeByKey.has(hit.key)) codeByKey.set(hit.key, hit);
  }
  const docSet = new Set(docKeys);

  for (const hit of codeByKey.values()) {
    if (docSet.has(hit.key)) continue;
    if (isAllowed("key-not-in-doc", hit.key, allowlist)) continue;
    errors.push(
      `设置键 ${hit.key}（定义于 ${hit.file}:${hit.line}）未登记进 settings-catalog.md——手抄清单漂移，补登记或说明为何不该登记`,
    );
  }
  for (const key of docSet) {
    if (codeByKey.has(key)) continue;
    if (isAllowed("key-not-in-code", key, allowlist)) continue;
    errors.push(
      `settings-catalog.md 登记了 ${key}，但代码里找不到它的定义——键已退役就删掉登记，或补一条豁免`,
    );
  }

  const remainingUsedCounts = new Map(allowlist.usedCounts);
  const stale = allowlist.entries.filter((entry) => {
    const keyName = allowlistKey(entry);
    const usedCount = remainingUsedCounts.get(keyName) ?? 0;
    if (usedCount <= 0) return true;
    remainingUsedCounts.set(keyName, usedCount - 1);
    return false;
  });
  return { errors, stale };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (isScannableFile(name)) out.push(full);
  }
  return out;
}

export function collectAll({ src = SCAN_ROOTS, docPath = CATALOG_DOC, allowlist = loadAllowlist() } = {}) {
  const codeKeys = [];
  for (const root of Array.isArray(src) ? src : [src]) {
    for (const full of walk(root)) {
      codeKeys.push(...scanCodeText(readFileSync(full, "utf8"), normalizePath(relative(ROOT, full))));
    }
  }
  const docKeys = existsSync(docPath) ? scanDocText(readFileSync(docPath, "utf8")) : [];
  return { codeKeys, docKeys, ...reconcile(codeKeys, docKeys, allowlist) };
}

function main() {
  if (process.argv.slice(2).includes("--help") || process.argv.slice(2).includes("-h")) {
    console.log(USAGE);
    return;
  }
  const { codeKeys, docKeys, errors, stale } = collectAll();
  if (errors.length > 0) {
    console.error(
      `✗ 设置键登记对账（${errors.length} 处不一致）：\n${errors.map((e) => `  ${e}`).join("\n")}\n\n修法指引：代码新增/退役键都要同步 settings-catalog.md 的 key 全表；确属豁免的写入 scripts/settings-catalog-allowlist.json 并说明理由。`,
    );
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error(
      `✗ settings-catalog allowlist 有 ${stale.length} 条已失效，请删除：\n${stale
        .map((entry) => `  ${entry.rule} ${entry.lineText} ${entry.reason}`)
        .join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `✓ 设置键登记对账：代码 ${codeKeys.length} 个键与 settings-catalog.md 登记（${docKeys.length} 个键）双向一致`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
