#!/usr/bin/env node
// Check that long-lived (evergreen / ADR) docs stay in sync with the code they cover.
// Usage: node scripts/check-evergreen-docs.mjs [--mode=warn|strict|stale|size] [--since=<rev>] [--write-size-baseline]
// Zero external deps. Glob syntax: **/, **, *, ?, optional ":Symbol" suffix is stripped.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVERGREEN_DIRS = ["docs/evergreen", "docs/adr"];
const STALE_DAYS = 180;
const SIZE_CAPS = { softChars: 15000, hardChars: 25000 };
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
      "  --mode=warn      (default) print impacted docs, exit 0",
      "  --mode=strict    exit 1 if any covered doc was not updated",
      `  --mode=stale     warn about docs whose last-reviewed is older than ${STALE_DAYS} days`,
      "  --mode=size      enforce evergreen docs size ratchet",
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

function parseFrontmatter(content) {
  const norm = content.replace(/\r\n?/g, "\n");
  if (!norm.startsWith("---\n")) return {};
  const closeIdx = norm.indexOf("\n---", 4);
  if (closeIdx === -1) return {};
  const lines = norm.slice(4, closeIdx).split("\n");
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const [, key, raw] = m;
    if (raw !== "") {
      data[key] = unquote(raw);
      i++;
    } else {
      i++;
      const arr = [];
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        arr.push(unquote(lines[i].replace(/^\s+-\s+/, "")));
        i++;
      }
      data[key] = arr;
    }
  }
  return data;
}

function stripCode(content) {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function parseMarkdownLinks(content) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m = re.exec(content);
  while (m !== null) {
    const raw = m[1].trim();
    const hashIdx = raw.indexOf("#");
    const target = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const anchor = hashIdx >= 0 ? raw.slice(hashIdx + 1) : null;
    if (target.endsWith(".md")) links.push({ target, anchor });
    m = re.exec(content);
  }
  return links;
}

function readDoc(rel) {
  const content = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const fm = parseFrontmatter(content);
  return {
    filePath: rel,
    type: fm.type ?? "",
    title: fm.title ?? path.basename(rel, ".md"),
    covers: Array.isArray(fm.covers) ? fm.covers : [],
    lastReviewed: fm["last-reviewed"] ?? null,
    chars: content.length,
    links: parseMarkdownLinks(stripCode(content)),
  };
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
  const known = new Set(docs.map((d) => d.filePath));
  const broken = [];
  for (const d of docs) {
    for (const link of d.links ?? []) {
      const target = link.target;
      if (/^https?:/.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(d.filePath), target));
      if (!(resolved.startsWith("docs/evergreen/") || resolved.startsWith("docs/adr/"))) continue;
      if (!known.has(resolved)) broken.push({ from: d.filePath, target });
    }
  }
  return { broken, ok: broken.length === 0 };
}

function isCodeFile(f) {
  if (f.startsWith("docs/")) return false;
  if (f === "README.md" || f === "CLAUDE.md") return false;
  return true;
}

function isDocFile(f) {
  return f.startsWith("docs/evergreen/") || f.startsWith("docs/adr/") || f === "README.md" || f === "CLAUDE.md";
}

function modeWarnOrStrict(docs, changed, strict) {
  const codeChanged = changed.filter(isCodeFile);
  const docsChanged = new Set(changed.filter(isDocFile));
  const hits = [];
  for (const f of codeChanged) {
    const md = docs.filter((d) => matchesAny(f, d.covers));
    if (md.length > 0) hits.push({ file: f, docs: md });
  }
  if (codeChanged.length === 0) {
    console.log("（没有代码改动需要检查。）");
    return 0;
  }
  if (hits.length === 0) {
    console.log(`✓ 检查了 ${codeChanged.length} 个改动的代码文件，没有命中任何长期文档的 covers。`);
    return 0;
  }
  console.log("📚 本次代码改动可能影响以下长期文档：\n");
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
  return d.filePath.startsWith("docs/evergreen/") && d.type !== "adr";
}

export function evaluateSizes(docs, baseline, _caps) {
  const violations = [];
  const currentEvergreenPaths = new Set(docs.filter(isEvergreenDoc).map((d) => d.filePath));
  for (const d of docs) {
    if (!isEvergreenDoc(d)) continue;
    const base = baseline[d.filePath];
    if (base) {
      if (d.chars > base.chars) {
        violations.push({ filePath: d.filePath, kind: "grew-chars", current: d.chars, limit: base.chars });
      }
      if (d.covers.length > base.covers) {
        violations.push({ filePath: d.filePath, kind: "grew-covers", current: d.covers.length, limit: base.covers });
      }
      continue;
    }
    violations.push({ filePath: d.filePath, kind: "missing-baseline", current: d.chars, limit: 0 });
  }
  for (const [filePath, base] of Object.entries(baseline)) {
    if (!currentEvergreenPaths.has(filePath)) {
      violations.push({ filePath, kind: "stale-baseline", current: 0, limit: base.chars });
    }
  }
  return {
    violations,
    ok: violations.length === 0,
  };
}

function buildSizeBaseline(docs) {
  return Object.fromEntries(
    docs
      .filter(isEvergreenDoc)
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((d) => [d.filePath, { chars: d.chars, covers: d.covers.length }]),
  );
}

function readSizeBaseline() {
  const baselinePath = path.join(REPO_ROOT, SIZE_BASELINE_PATH);
  if (!fs.existsSync(baselinePath)) return null;
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

function writeSizeBaseline(docs) {
  const baseline = buildSizeBaseline(docs);
  const baselinePath = path.join(REPO_ROOT, SIZE_BASELINE_PATH);
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`✓ 写入 ${Object.keys(baseline).length} 份 evergreen 文档体量基线：${SIZE_BASELINE_PATH}`);
  return 0;
}

function formatSizeViolationKind(kind) {
  switch (kind) {
    case "grew-chars":
      return "字符数超过基线";
    case "grew-covers":
      return "covers 数超过基线";
    case "missing-baseline":
      return "文档缺少体量基线";
    case "stale-baseline":
      return "基线包含已移除文档";
    default:
      return kind;
  }
}

function modeSize(docs) {
  const baseline = readSizeBaseline();
  if (!baseline) {
    console.error(`✗ 缺少 evergreen 文档体量基线：${SIZE_BASELINE_PATH}`);
    console.error("  请运行 node scripts/check-evergreen-docs.mjs --write-size-baseline 后提交基线。");
    return 1;
  }
  const res = evaluateSizes(docs, baseline, SIZE_CAPS);
  if (res.violations.length === 0) {
    console.log(`✓ evergreen 文档体量未超过基线（soft ${SIZE_CAPS.softChars} / hard ${SIZE_CAPS.hardChars} 字符）。`);
    return 0;
  }
  console.log("📏 evergreen 文档体量棘轮检查：\n");
  console.log("| 文档 | 类型 | 当前 | 限制 |");
  console.log("|---|---|---:|---:|");
  for (const v of res.violations) {
    console.log(`| \`${v.filePath}\` | ✗ ${formatSizeViolationKind(v.kind)} | ${v.current} | ${v.limit} |`);
  }
  console.error("\n✗ 文档体量超过棘轮。请下沉/拆分内容，或确认合理增长后重写基线。");
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
  return 1;
}

function modeLinks(docs) {
  const res = evaluateLinks(docs);
  if (res.ok) {
    console.log(`✓ evergreen 文档内部 .md 链接全部解析通过（${docs.length} 份）。`);
    return 0;
  }
  console.error("✗ 发现指向不存在文档的内部链接：\n");
  for (const b of res.broken) console.error(`  ${b.from} → ${b.target}`);
  console.error("\n文档重命名/移动后请更新引用方的链接。");
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
