#!/usr/bin/env node
// Check that long-lived (evergreen / ADR) docs stay in sync with the code they cover.
// covers = 纯归属声明（coverage / 查代码去哪篇）；contracts = 「改它文档必错」的契约点集合，只有它触发 strict。
// 两者各自独立，至少一个非空；双空会触发 no-gate（见 _docs-guide §1.3）。
// Usage: node scripts/check-evergreen-docs.mjs [--mode=warn|strict|stale|size|coverage|links] [--since=<rev>] [--write-size-baseline]
// Zero external deps. Glob syntax: **/, **, *, ?, optional ":Symbol" suffix is stripped.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVERGREEN_DIRS = ["docs/evergreen", "docs/adr"];
const STALE_DAYS = 180;
// 四档阈值：softChars 起软提示，warnChars / criticalChars 逐级加重措辞，hardChars 硬报错。
// 分级是为了破提示疲劳——长期驻留区间的文档若每次都印同一句，警告等于不存在。
export const SIZE_CAPS = { softChars: 15000, warnChars: 20000, criticalChars: 23000, hardChars: 25000 };
const SIZE_BASELINE_PATH = "scripts/evergreen-size-baseline.json";
// 覆盖率检查：这些源根下的新增文件必须被某份 evergreen 文档的 covers 认领。
const COVERAGE_ROOTS = [
  "packages/client/src/",
  "packages/server/src/",
  "packages/shared/src/",
  "packages/cli/src/",
];
// 豁免：测试 / 类型声明 / mock / 夹具 / story 不要求文档归属。
const COVERAGE_EXEMPTS = [
  /\.test\.[jt]sx?$/,
  /\.test-d\.ts$/,
  /\.d\.ts$/,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)fixtures?\//,
  /(^|\/)test-utils?\//,
  /\.stories\.[jt]sx?$/,
];
const REGEXP_SPECIAL_CHARS = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
export const FRONTMATTER_KEYS = {
  type: { required: true, valueType: "scalar" },
  title: { required: true, valueType: "scalar" },
  "last-reviewed": { required: true, valueType: "scalar" },
  covers: { required: false, valueType: "list" },
  contracts: { required: false, valueType: "list" },
};

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
    this.exitCode = 2;
  }
}

export function parseArgs(argv) {
  const opts = { mode: "warn", since: "HEAD", help: false, writeSizeBaseline: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--write-size-baseline") opts.writeSizeBaseline = true;
    else if (arg.startsWith("--mode=")) opts.mode = arg.slice(7);
    else if (arg.startsWith("--since=")) opts.since = arg.slice(8);
    else {
      throw new CliUsageError(`Unknown argument: ${arg}`);
    }
  }
  if (!["warn", "strict", "stale", "size", "coverage", "links"].includes(opts.mode)) {
    throw new CliUsageError(`--mode must be warn|strict|stale|size|coverage|links, got: ${opts.mode}`);
  }
  return opts;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/check-evergreen-docs.mjs [options]",
      "",
      "Options:",
      "  --mode=warn      (default) print docs whose covers were touched, exit 0",
      "  --mode=strict    exit 1 if a changed file hits a doc's contracts but that doc was not updated",
      `  --mode=stale     warn about docs whose last-reviewed is older than ${STALE_DAYS} days`,
      `  --mode=size      fail if a doc exceeds hard cap (${SIZE_CAPS.hardChars} chars, split it) or covers grew past baseline`,
      "  --mode=coverage  fail if newly-added source files have no owning doc (uses --since)",
      "  --mode=links     fail if any internal .md link points to a missing doc",
      "  --since=<rev>    compare against <rev> (default: HEAD; e.g. origin/main for CI)",
      "  --write-size-baseline  rewrite scripts/evergreen-size-baseline.json",
      "  --help, -h       show this message",
    ].join("\n"),
  );
}

function listMarkdownFiles(dir) {
  const fullDir = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(fullDir)) return [];
  const result = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        result.push(path.relative(REPO_ROOT, p).replace(/\\/g, "/"));
      }
    }
  }
  walk(fullDir);
  return result;
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

export function parseFrontmatter(content) {
  const norm = content.replace(/\r\n?/g, "\n");
  if (!norm.startsWith("---\n")) return { data: {}, issues: [] };
  const closeIdx = norm.indexOf("\n---", 4);
  if (closeIdx === -1) return { data: {}, issues: [] };
  const lines = norm.slice(4, closeIdx).split("\n");
  const data = {};
  const issues = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!m) {
      issues.push({
        kind: "unconsumed-line",
        detail: `unconsumed frontmatter line: ${JSON.stringify(line)}`,
      });
      i++;
      continue;
    }
    const [, key, raw] = m;
    if (key in data) {
      issues.push({
        kind: "duplicate-key",
        key,
        detail: `duplicate frontmatter key "${key}"`,
      });
    }
    if (raw !== "") {
      data[key] = unquote(raw);
      i++;
    } else {
      i++;
      const arr = [];
      while (i < lines.length && /^\s*-/.test(lines[i])) {
        const item = lines[i].match(/^  -\s+(\S.*)$/);
        if (item) {
          arr.push(unquote(item[1]));
        } else {
          issues.push({
            kind: "invalid-list-item",
            key,
            detail: `invalid list item for "${key}": ${JSON.stringify(lines[i])}`,
          });
        }
        i++;
      }
      data[key] = arr;
    }
  }
  return { data, issues };
}

function formatFrontmatterListTypeDetail(key) {
  return `\`${key}:\` 冒号后不能有任何字符（包括 \`[]\` 和行尾 \`#\` 注释）；下一行直接写 \`  - item\`。`;
}

export function validateFrontmatter(fm, filePath) {
  const issues = [];
  for (const key of Object.keys(fm)) {
    if (!FRONTMATTER_KEYS[key]) {
      issues.push({
        filePath,
        kind: "unknown-key",
        key,
        detail: `unknown frontmatter key "${key}"`,
      });
    }
  }
  for (const [key, spec] of Object.entries(FRONTMATTER_KEYS)) {
    if (!(key in fm)) {
      if (spec.required) {
        issues.push({
          filePath,
          kind: "missing-key",
          key,
          detail: `missing required frontmatter key "${key}"`,
        });
      }
      continue;
    }
    const value = fm[key];
    if (spec.valueType === "list" && !Array.isArray(value)) {
      issues.push({
        filePath,
        kind: "bad-type",
        key,
        detail: formatFrontmatterListTypeDetail(key),
      });
    } else if (spec.valueType === "scalar" && (Array.isArray(value) || typeof value !== "string")) {
      issues.push({
        filePath,
        kind: "bad-type",
        key,
        detail: `"${key}" must be a scalar string`,
      });
    }
  }
  if (filePath.startsWith("docs/evergreen/") && fm.type !== "evergreen") {
    issues.push({
      filePath,
      kind: "bad-value",
      key: "type",
      detail: '"type" must be exactly "evergreen"',
    });
  }
  return issues;
}

function stripInlineCode(line) {
  let output = "";
  let cursor = 0;
  while (cursor < line.length) {
    const start = line.indexOf("`", cursor);
    if (start < 0) {
      output += line.slice(cursor);
      break;
    }
    output += line.slice(cursor, start);
    let openingEnd = start + 1;
    while (line[openingEnd] === "`") openingEnd += 1;
    const runLength = openingEnd - start;
    let search = openingEnd;
    let closingStart = -1;
    while (search < line.length) {
      const candidate = line.indexOf("`", search);
      if (candidate < 0) break;
      let candidateEnd = candidate + 1;
      while (line[candidateEnd] === "`") candidateEnd += 1;
      if (candidateEnd - candidate === runLength) {
        closingStart = candidate;
        break;
      }
      search = candidateEnd;
    }
    if (closingStart < 0) {
      output += line.slice(start, openingEnd);
      cursor = openingEnd;
      continue;
    }
    cursor = closingStart + runLength;
  }
  return output;
}

export function stripCode(content) {
  let fence = null;
  return content
    .split("\n")
    .map((line) => {
      if (fence) {
        const closing = line.match(/^[ \t]{0,3}([`~]{3,})[ \t]*$/);
        if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) fence = null;
        return "";
      }
      const opening = line.match(/^[ \t]{0,3}([`~]{3,})(.*)$/);
      if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
        fence = { char: opening[1][0], length: opening[1].length };
        return "";
      }
      if (/^(?: {4}|\t)/.test(line)) return "";
      return stripInlineCode(line);
    })
    .join("\n");
}

export function parseAnchors(content) {
  return [...content.matchAll(/<a\s+id="([^"]+)"\s*>\s*<\/a\s*>/g)].map((match) => match[1]);
}

export function findMalformedAnchors(content) {
  const malformed = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    const opening = text.match(/^<a\b[^>]*>/i)?.[0];
    const attributes = opening?.slice(2, -1).replace(/"[^"]*"|'[^']*'/g, "") ?? "";
    if (!opening || !/(?:^|\s)id\s*=/i.test(attributes)) continue;
    if (!/^<a\s+id="[^"]+"\s*>\s*<\/a\s*>$/.test(text)) {
      malformed.push({ line: index + 1, text });
    }
  }
  return malformed;
}

export function parseMarkdownLinks(content) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m = re.exec(content);
  while (m !== null) {
    const raw = m[1].trim();
    const hashIdx = raw.indexOf("#");
    const target = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const anchor = hashIdx >= 0 ? raw.slice(hashIdx + 1) : null;
    const line = content.slice(0, m.index).split("\n").length;
    if (target.endsWith(".md")) links.push({ target, anchor, line });
    m = re.exec(content);
  }
  return links;
}

export function parseDoc(rel, content) {
  const { data: fm, issues: parseIssues } = parseFrontmatter(content);
  const strippedContent = stripCode(content);
  const frontmatterIssues = rel.startsWith("docs/evergreen/")
    ? [...parseIssues.map((issue) => ({ filePath: rel, ...issue })), ...validateFrontmatter(fm, rel)]
    : [];
  return {
    filePath: rel,
    type: fm.type ?? "",
    title: fm.title ?? path.basename(rel, ".md"),
    covers: Array.isArray(fm.covers) ? fm.covers : [],
    // contracts：「改这个文件、不改文档，文档一定错」的契约点集合（schema / 登记簿 / API 面）。
    // 与 covers 各自独立解析，不校验包含关系——陈述契约的纵切子文档可零 covers、独立持 contracts。
    // strict 只认它；covers 是纯归属声明，不触发 strict。
    contracts: Array.isArray(fm.contracts) ? fm.contracts : [],
    lastReviewed: fm["last-reviewed"] ?? null,
    chars: content.length,
    links: parseMarkdownLinks(strippedContent),
    anchors: parseAnchors(strippedContent),
    malformedAnchors: findMalformedAnchors(strippedContent),
    frontmatterIssues,
  };
}

function readDoc(rel) {
  return parseDoc(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

function patternToRegex(pattern) {
  const colonIdx = pattern.lastIndexOf(":");
  const normalizedPattern = colonIdx > 0 && !pattern.slice(colonIdx + 1).includes("/") ? pattern.slice(0, colonIdx) : pattern;
  let out = "";
  let i = 0;
  while (i < normalizedPattern.length) {
    const c = normalizedPattern[i];
    if (c === "*") {
      if (normalizedPattern[i + 1] === "*") {
        if (normalizedPattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      out += "[^/]";
      i += 1;
    } else if (REGEXP_SPECIAL_CHARS.has(c)) {
      out += `\\${c}`;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(file, globs) {
  return globs.some((g) => patternToRegex(g).test(file));
}

export function getChangedFiles(since, { execFileSync: runExecFileSync = execFileSync } = {}) {
  const out = [];
  const gitOptions = { cwd: REPO_ROOT, encoding: "utf8" };
  try {
    const diff = runExecFileSync("git", ["diff", since, "--name-only"], gitOptions);
    for (const line of diff.split("\n")) {
      const f = line.trim();
      if (f) out.push(f);
    }
    if (since === "HEAD") {
      const untracked = runExecFileSync("git", ["ls-files", "--others", "--exclude-standard"], gitOptions);
      for (const line of untracked.split("\n")) {
        const f = line.trim();
        if (f) out.push(f);
      }
    }
  } catch (err) {
    console.error("git diff failed:", err.message);
    return [];
  }
  return [...new Set(out)];
}

export function getAddedFiles(since, { execFileSync: runExecFileSync = execFileSync } = {}) {
  const out = [];
  const gitOptions = { cwd: REPO_ROOT, encoding: "utf8" };
  try {
    const diff = runExecFileSync("git", ["diff", "--diff-filter=A", "--name-only", since], gitOptions);
    for (const line of diff.split("\n")) {
      const f = line.trim();
      if (f) out.push(f);
    }
    const untracked = runExecFileSync("git", ["ls-files", "--others", "--exclude-standard"], gitOptions);
    for (const line of untracked.split("\n")) {
      const f = line.trim();
      if (f) out.push(f);
    }
  } catch (err) {
    console.error("git diff failed:", err.message);
    return [];
  }
  return [...new Set(out)];
}

export function selectUncovered(files, docs, { roots, exempts }) {
  const allCovers = docs.flatMap((d) => d.covers ?? []);
  return files.filter((f) => {
    if (!roots.some((r) => f.startsWith(r))) return false;
    if (exempts.some((re) => re.test(f))) return false;
    return !matchesAny(f, allCovers);
  });
}

export function evaluateLinks(docs) {
  const known = new Map(docs.map((d) => [d.filePath, d]));
  const broken = [];
  for (const d of docs) {
    for (const link of d.links ?? []) {
      const target = link.target;
      if (/^https?:/.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(d.filePath), target));
      if (!(resolved.startsWith("docs/evergreen/") || resolved.startsWith("docs/adr/"))) continue;
      const targetDoc = known.get(resolved);
      if (!targetDoc) {
        broken.push({ from: d.filePath, line: link.line ?? 0, target, kind: "missing-doc" });
        continue;
      }
      if (link.anchor && !(targetDoc.anchors ?? []).includes(link.anchor)) {
        broken.push({
          from: d.filePath,
          line: link.line ?? 0,
          target: `${target}#${link.anchor}`,
          kind: "missing-anchor",
        });
      }
    }
  }
  return { broken, ok: broken.length === 0 };
}

export function findDuplicateAnchors(docs) {
  const firstById = new Map();
  const duplicates = [];
  for (const doc of docs) {
    for (const id of doc.anchors ?? []) {
      const first = firstById.get(id);
      if (first) duplicates.push({ id, first, second: doc.filePath });
      else firstById.set(id, doc.filePath);
    }
  }
  return duplicates;
}

function isCodeFile(f) {
  if (f.startsWith("docs/")) return false;
  if (f === "README.md" || f === "CLAUDE.md") return false;
  return true;
}

function isDocFile(f) {
  return f.startsWith("docs/evergreen/") || f.startsWith("docs/adr/") || f === "README.md" || f === "CLAUDE.md";
}

// §0 内容边界摘要：印在「要动 evergreen 文档」的时刻（strict/coverage 失败、diff 含 evergreen 改动）。
// 只抄 _docs-guide §0 里最稳定的内核（判据一句话 + 归属去向），别往这里搬整段——那是第二份会腐烂的副本。
export const EVERGREEN_RULES_SUMMARY = [
  "—— evergreen 写作规矩（详见 docs/evergreen/_docs-guide.md §0）——",
  "  只写「没有任何改动发生时也成立」的现状：机制 / 契约 / 不变量 / 边界。",
  "  决策论证归 docs/adr，对 agent 的指令与授权归 AGENTS.md，改动流水归提交信息，在办事项归 docs_local。",
  "  禁时间性措辞（目前 / 本轮 / 新增了 / 已改为）；只写 grep 不出来的，其余只指路。",
  "  抄了清单就把源文件挂进 contracts；挂不了就改成指针；没有源文件可挂的只能删（权威导航入口除外）。",
];

function printRulesSummary(log) {
  log("");
  for (const line of EVERGREEN_RULES_SUMMARY) log(line);
}

// 本次改动里被动过的 evergreen 正文（不含 ADR——ADR 只追加，不受 §0 约束）。
export function selectChangedEvergreenDocs(changed) {
  return changed.filter((f) => f.startsWith("docs/evergreen/") && f.endsWith(".md"));
}

// 纯函数：给定改动集与判定字段（covers / contracts），算出命中的文档及是否同步更新。
// warn 用 covers（软提示，列出可能受影响的文档），strict 用 contracts（改契约必改文档）。
export function evaluateDocSync(docs, changed, { field }) {
  const codeChanged = changed.filter(isCodeFile);
  const docsChanged = new Set(changed.filter(isDocFile));
  const hits = [];
  for (const f of codeChanged) {
    const md = docs.filter((d) => matchesAny(f, d[field] ?? []));
    if (md.length > 0) hits.push({ file: f, docs: md });
  }
  const unmatched = hits.flatMap((hit) => hit.docs).filter((doc) => !docsChanged.has(doc.filePath)).length;
  return { codeChanged, docsChanged, hits, unmatched };
}

function modeWarnOrStrict(docs, changed, strict) {
  const field = strict ? "contracts" : "covers";
  const { codeChanged, docsChanged, hits } = evaluateDocSync(docs, changed, { field });
  // 改了 evergreen 正文就提醒自查 §0——不管本次检查过不过：内容写错层是机检查不出的，只能在写的时刻拦。
  const touchedEvergreen = selectChangedEvergreenDocs(changed);
  if (touchedEvergreen.length > 0) {
    console.log(`ℹ️ 本次改动包含 ${touchedEvergreen.length} 份 evergreen 文档，写入前自查 §0：无祈使句、无论证、无时间性措辞。`);
    printRulesSummary(console.log);
    console.log("");
  }
  if (codeChanged.length === 0) {
    console.log("（没有代码改动需要检查。）");
    return 0;
  }
  if (hits.length === 0) {
    console.log(`✓ 检查了 ${codeChanged.length} 个改动的代码文件，没有命中任何长期文档的 ${field}。`);
    return 0;
  }
  console.log(
    strict
      ? "📚 本次代码改动命中以下长期文档的 contracts（改契约必同步文档）：\n"
      : "📚 本次代码改动可能影响以下长期文档：\n",
  );
  console.log("| 改动的代码 | 相关 evergreen 文档 | 状态 |");
  console.log("|---|---|---|");
  let unmatched = 0;
  for (const hit of hits) {
    for (const doc of hit.docs) {
      const updated = docsChanged.has(doc.filePath);
      const status = updated ? "✅ 已同步更新" : "⚠️ 未更新";
      if (!updated) unmatched++;
      console.log(`| \`${hit.file}\` | [${doc.title}](${doc.filePath}) | ${status} |`);
    }
  }
  if (unmatched === 0) {
    console.log("\n✓ 所有相关文档都在本次改动里同步更新了。");
    return 0;
  }
  if (strict) {
    console.error(`\n✗ 有 ${unmatched} 处文档命中但未同步更新（strict 模式）。`);
    console.error("  请同步更新文档，或在确认无需修改时通过其他方式跳过此检查。");
    printRulesSummary(console.error);
    return 1;
  }
  console.log(`\n⚠️ 有 ${unmatched} 处文档命中但未更新。请确认是否需要同步修改。`);
  return 0;
}

function modeStale(docs) {
  const now = Date.now();
  const stale = [];
  const missing = [];
  for (const d of docs) {
    if (d.type === "adr") continue;
    if (!d.lastReviewed) {
      missing.push(d);
      continue;
    }
    const reviewed = new Date(d.lastReviewed);
    if (Number.isNaN(reviewed.getTime())) {
      missing.push(d);
      continue;
    }
    const ageDays = Math.floor((now - reviewed.getTime()) / 86400000);
    if (ageDays > STALE_DAYS) stale.push({ doc: d, ageDays });
  }
  if (stale.length === 0 && missing.length === 0) {
    const ev = docs.filter((d) => d.type !== "adr").length;
    console.log(`✓ 所有 ${ev} 份 evergreen 文档的 last-reviewed 都在 ${STALE_DAYS} 天内。`);
    return 0;
  }
  if (stale.length > 0) {
    console.log(`⏰ 以下 evergreen 文档超过 ${STALE_DAYS} 天未审阅：\n`);
    for (const s of stale.sort((a, b) => b.ageDays - a.ageDays)) {
      console.log(`  ${s.doc.filePath}  (${s.ageDays} 天前 reviewed: ${s.doc.lastReviewed})`);
    }
    console.log("");
  }
  if (missing.length > 0) {
    console.log("⚠️ 以下 evergreen 文档缺少 last-reviewed 字段：\n");
    for (const d of missing) console.log(`  ${d.filePath}`);
    console.log("");
  }
  return 0;
}

function isEvergreenDoc(d) {
  return d.filePath.startsWith("docs/evergreen/");
}

// size 不再对正文字符数做「只降不升」棘轮——正文可增长，但硬上限与结构闸仍会拦。
// 它同时检查 frontmatter 形状、covers/contracts 双空 no-gate、hard cap、covers baseline 增长，以及 baseline 漏项 / 保留已删除文档。
export function evaluateSizes(docs, baseline, caps) {
  const hardChars = caps?.hardChars ?? SIZE_CAPS.hardChars;
  const violations = [];
  const currentEvergreenPaths = new Set(docs.filter(isEvergreenDoc).map((d) => d.filePath));
  for (const d of docs) {
    if (!isEvergreenDoc(d)) continue;
    const covers = Array.isArray(d.covers) ? d.covers : [];
    const contracts = Array.isArray(d.contracts) ? d.contracts : [];
    const base = baseline[d.filePath];
    if (!base) {
      violations.push({ filePath: d.filePath, kind: "missing-baseline", current: d.chars, limit: 0 });
      continue;
    }
    if (covers.length > base.covers) {
      violations.push({ filePath: d.filePath, kind: "grew-covers", current: covers.length, limit: base.covers });
    }
    if (d.chars > hardChars) {
      violations.push({ filePath: d.filePath, kind: "too-long", current: d.chars, limit: hardChars });
    }
    if (covers.length === 0 && contracts.length === 0) {
      violations.push({ filePath: d.filePath, kind: "no-gate", current: 0, limit: 0 });
    }
  }
  for (const [filePath, base] of Object.entries(baseline)) {
    if (!currentEvergreenPaths.has(filePath)) {
      violations.push({ filePath, kind: "stale-baseline", current: 0, limit: base.covers });
    }
  }
  return {
    violations,
    ok: violations.length === 0,
  };
}

function buildSizeBaseline(docs) {
  // 基线只记 covers 数（管辖范围棘轮）与文档存在性；字符数不再入基线——正文长度由 hard cap 绝对上限守，不做棘轮。
  return Object.fromEntries(
    docs
      .filter(isEvergreenDoc)
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((d) => [d.filePath, { covers: d.covers.length }]),
  );
}

function readSizeBaseline() {
  const baselinePath = path.join(REPO_ROOT, SIZE_BASELINE_PATH);
  if (!fs.existsSync(baselinePath)) return null;
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

/**
 * 为什么这里仍是"整体重写"而不像 check-test-hygiene 那样改成 --add 单条登记：
 * 本基线是 filePath → covers 的**完整映射**，新增文档 / 拆子文档 / 删文档都要求条目全量重建，
 * 单条增量反而做不完整（missing-baseline、stale-baseline 两类违规就是靠全量重建消掉的）。
 * 真正的风险与 --write-baseline 同源——顺手把**别的**文档的 covers 上限一起抬高、棘轮静默放松。
 * 所以这里不改机制，改成"喊出来"：被抬高的 covers 逐条打印 old→new，让 review 一眼看见。
 */
export function diffSizeBaseline(previous, baseline) {
  const raised = [];
  const lowered = [];
  const added = [];
  for (const [filePath, entry] of Object.entries(baseline)) {
    const before = previous[filePath];
    if (!before) added.push(filePath);
    else if (entry.covers > before.covers) raised.push(`${filePath}：covers ${before.covers} → ${entry.covers}`);
    else if (entry.covers < before.covers) lowered.push(`${filePath}：covers ${before.covers} → ${entry.covers}`);
  }
  const removed = Object.keys(previous).filter((filePath) => !baseline[filePath]);
  return { added, removed, raised, lowered };
}

function writeSizeBaseline(docs) {
  const baseline = buildSizeBaseline(docs);
  const { added, removed, raised, lowered } = diffSizeBaseline(readSizeBaseline() ?? {}, baseline);
  const baselinePath = path.join(REPO_ROOT, SIZE_BASELINE_PATH);
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`✓ 写入 ${Object.keys(baseline).length} 份 evergreen 文档体量基线：${SIZE_BASELINE_PATH}`);
  if (added.length > 0) console.log(`  新增文档 ${added.length} 份：\n${added.map((f) => `    + ${f}`).join("\n")}`);
  if (removed.length > 0) console.log(`  移除文档 ${removed.length} 份：\n${removed.map((f) => `    - ${f}`).join("\n")}`);
  if (lowered.length > 0) console.log(`  covers 收窄（棘轮收紧）${lowered.length} 份：\n${lowered.map((f) => `    ${f}`).join("\n")}`);
  if (raised.length > 0) {
    console.log(
      `⚠️ covers 上限被抬高 ${raised.length} 份——棘轮在这里被放松了，逐条确认都是本次改动应得的管辖扩张：\n` +
        raised.map((f) => `    ${f}`).join("\n"),
    );
  }
  return 0;
}

export function listSubDocs(docPath, allDocs) {
  const dir = docPath.replace(/\.md$/, "/");
  return allDocs
    .filter((d) => d.filePath !== docPath && d.filePath.startsWith(dir))
    .map((d) => ({ filePath: d.filePath, chars: d.chars, covers: d.covers?.length ?? 0 }))
    .sort((a, b) => b.chars - a.chars);
}

export function buildHardCapAdviceLines(tooLong, allDocs, caps = SIZE_CAPS) {
  const hardChars = caps?.hardChars ?? SIZE_CAPS.hardChars;
  const lines = [
    `\n✗ 有文档超过 hard cap（${hardChars} 字符）。字符数本身不做棘轮，正文可自由增长——过长说明该拆了。`,
    "  合法动作四条：① 删过时 / 越界内容（越界的先补落点、再 trim 成「一句现状 + 指针」，不许就地删）",
    "               ② 横切外提（功能子域） ③ 纵切外提（读者路径）",
    "               ④ 升格（子文档长成主题时提到上一层）。",
    "  ⚠️ 压缩措辞、删例子、把句子改短不是合法动作——那是拿可读性换体量，且不可逆。",
    "  四条都走不通就停下来问人，不要让门禁绿变成目标。",
  ];
  for (const v of tooLong) {
    const subDocs = listSubDocs(v.filePath, allDocs);
    if (subDocs.length === 0) continue;
    lines.push(`  · ${v.filePath} 已有 ${subDocs.length} 份子文档：`);
    for (const subDoc of subDocs) {
      lines.push(`      - ${subDoc.filePath}（${subDoc.chars} 字符，covers ${subDoc.covers}）`);
    }
  }
  lines.push("  判据：docs/evergreen/_docs-guide/splitting.md（横切三条 / 纵切四条 / 升格三条）。");
  return lines;
}

/**
 * 软提示分级。超 hard cap 的返回 null——那由 too-long 违规硬报错处理，不再叠加软提示。
 * caps 缺字段就回落到 SIZE_CAPS（与 evaluateSizes 同姿态）：裸读会让 `chars > undefined` 恒假，
 * 把 🔴 静默降成 🟡。
 */
export function classifySizeWarning(chars, caps) {
  const { softChars, warnChars, criticalChars, hardChars } = { ...SIZE_CAPS, ...caps };
  if (chars > hardChars) return null;
  if (chars > criticalChars) return "critical";
  if (chars > warnChars) return "warning";
  if (chars > softChars) return "notice";
  return null;
}

const BAND_HINT = {
  notice: "过 soft cap，留意是否该拆子文档",
  warning: "余量不足 5k，规划下一份子文档的切法",
  critical: "余量不足 2k，下次实质补充就会撞线——现在拆比撞线时拆从容",
};

/**
 * 体量软提示的渲染数据：过 soft cap 未过 hard cap 的文档，按字符数倒序，各带档位图标、余量与提示语。
 */
export function buildSizeHints(docs, caps) {
  const hardChars = caps?.hardChars ?? SIZE_CAPS.hardChars;
  return docs
    .map((d) => ({ doc: d, band: classifySizeWarning(d.chars, caps) }))
    .filter((x) => x.band !== null)
    .sort((a, b) => b.doc.chars - a.doc.chars)
    .map(({ doc, band }) => ({
      filePath: doc.filePath,
      band,
      mark: band === "critical" ? "🔴" : band === "warning" ? "🟠" : "🟡",
      chars: doc.chars,
      remaining: hardChars - doc.chars,
      hint: BAND_HINT[band],
    }));
}

export function formatSizeViolationKind(kind) {
  switch (kind) {
    case "too-long":
      return "文档过长（超 hard cap，建议拆子文档）";
    case "grew-covers":
      return "covers 数超过基线";
    case "missing-baseline":
      return "文档缺少体量基线";
    case "stale-baseline":
      return "基线包含已移除文档";
    case "no-gate":
      return "covers/contracts 双空（请补 covers 或 contracts）";
    default:
      return kind;
  }
}

export function modeSize(docs, { baseline = readSizeBaseline(), error = console.error, log = console.log } = {}) {
  if (!baseline) {
    error(`✗ 缺少 evergreen 文档体量基线：${SIZE_BASELINE_PATH}`);
    error("  请运行 node scripts/check-evergreen-docs.mjs --write-size-baseline 后提交基线。");
    return 1;
  }
  const frontmatterIssues = docs.flatMap((d) => d.frontmatterIssues ?? []);
  if (frontmatterIssues.length > 0) {
    error("✗ evergreen frontmatter 形状检查失败：\n");
    for (const issue of frontmatterIssues) error(`  ${issue.filePath}: ${issue.detail}`);
    error(
      "\n  covers/contracts 列表写法：冒号后绝对留空无字符（含行尾 # 注释），下一行直接写 `  - item`；不要写 `covers: []`。",
    );
    return 1;
  }
  const evergreenDocs = docs.filter(isEvergreenDoc);
  const res = evaluateSizes(docs, baseline, SIZE_CAPS);
  // soft cap 软提示：不失败，只给「快到该拆了」一个提前量。分三档不是为了更精确，
  // 而是破提示疲劳——同一句警告长期不变会退化成背景噪音，措辞随余量加重才还能被看见。
  const hints = buildSizeHints(evergreenDocs, SIZE_CAPS);
  if (hints.length > 0) {
    log(`ℹ️ 体量提示（hard cap ${SIZE_CAPS.hardChars} 字符，判据见 docs/evergreen/_docs-guide/splitting.md）：`);
    for (const h of hints) {
      log(`   ${h.mark} ${h.filePath}（${h.chars} 字符，余量 ${h.remaining}）——${h.hint}`);
    }
    log("");
  }
  if (res.violations.length === 0) {
    log(`✓ evergreen 文档体量检查通过（无文档超 hard cap ${SIZE_CAPS.hardChars} 字符、无 covers 越基线）。`);
    return 0;
  }
  log("📏 evergreen 文档体量检查：\n");
  log("| 文档 | 问题 | 当前 | 限制 |");
  log("|---|---|---:|---:|");
  for (const v of res.violations) {
    log(`| \`${v.filePath}\` | ✗ ${formatSizeViolationKind(v.kind)} | ${v.current} | ${v.limit} |`);
  }
  const tooLong = res.violations.filter((v) => v.kind === "too-long");
  if (tooLong.length > 0) {
    for (const line of buildHardCapAdviceLines(tooLong, evergreenDocs, SIZE_CAPS)) error(line);
  }
  if (res.violations.some((v) => ["grew-covers", "missing-baseline", "stale-baseline"].includes(v.kind))) {
    error("\n✗ covers 管辖范围越基线 / 基线缺项或含已删文档：重写基线 `--write-size-baseline` 并在提交信息说明。");
  }
  if (res.violations.some((v) => v.kind === "no-gate")) {
    error(
      "\n✗ 有 evergreen 文档 covers/contracts 双空：请补 covers 或 contracts；纵切契约文档可 covers 留空，但必须列 contracts，纯代码入口地图应列精确 covers。",
    );
  }
  return 1;
}

function modeCoverage(docs, since) {
  const added = getAddedFiles(since);
  const uncovered = selectUncovered(added, docs, { roots: COVERAGE_ROOTS, exempts: COVERAGE_EXEMPTS });
  if (uncovered.length === 0) {
    console.log("✓ 新增源文件都有归属 evergreen 文档（或属豁免）。");
    return 0;
  }
  console.error("✗ 以下新增源文件没有任何 evergreen 文档的 covers 认领：\n");
  for (const f of uncovered) console.error(`  ${f}`);
  console.error("\n请把它归入某个主题文档的 covers，或确属测试/类型/夹具时加入 COVERAGE_EXEMPTS。");
  printRulesSummary(console.error);
  return 1;
}

export function modeLinks(docs) {
  const linkResult = evaluateLinks(docs);
  const malformed = docs.flatMap((doc) =>
    (doc.malformedAnchors ?? []).map((anchor) => ({ filePath: doc.filePath, ...anchor })),
  );
  const duplicates = findDuplicateAnchors(docs);
  if (linkResult.ok && malformed.length === 0 && duplicates.length === 0) {
    console.log(`✓ evergreen 文档内部 .md 链接与显式锚点全部解析通过（${docs.length} 份）。`);
    return 0;
  }
  if (!linkResult.ok) {
    console.error("✗ 发现指向不存在文档或显式锚点的内部链接：\n");
    for (const broken of linkResult.broken) {
      console.error(`  ${broken.from}:${broken.line} → ${broken.target}`);
    }
    console.error("\n文档重命名/移动后请更新引用；带 # 的链接必须指向目标文档中的显式锚点。");
  }
  if (malformed.length > 0) {
    console.error("\n✗ 发现畸形的显式锚点：\n");
    for (const anchor of malformed) console.error(`  ${anchor.filePath}:${anchor.line ?? 0} → ${anchor.text}`);
    console.error('\n显式锚点必须独立成行并严格配对，例如 <a id="example"></a>；不接受未闭合或自闭合。');
  }
  if (duplicates.length > 0) {
    console.error("\n✗ 发现重复的显式锚点 ID：\n");
    for (const duplicate of duplicates) {
      console.error(`  ${duplicate.id} → ${duplicate.first} / ${duplicate.second}`);
    }
    console.error("\n显式锚点 ID 必须在全部长期文档中保持唯一。");
  }
  return 1;
}

export function runEvergreenDocCheck(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const docs = EVERGREEN_DIRS.flatMap(listMarkdownFiles).map(readDoc);
  console.log(`Loaded ${docs.length} long-lived doc(s) from ${EVERGREEN_DIRS.join(", ")}.\n`);
  if (args.writeSizeBaseline) return writeSizeBaseline(docs);
  if (args.mode === "stale") return modeStale(docs);
  if (args.mode === "size") return modeSize(docs);
  if (args.mode === "links") {
    const rootSources = ["AGENTS.md", "README.md"]
      .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)))
      .map(readDoc);
    return modeLinks([...docs, ...rootSources]);
  }
  if (args.mode === "coverage") return modeCoverage(docs, args.since);
  const changed = getChangedFiles(args.since);
  return modeWarnOrStrict(docs, changed, args.mode === "strict");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(runEvergreenDocCheck());
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    throw err;
  }
}
