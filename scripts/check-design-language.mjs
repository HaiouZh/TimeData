import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages", "client", "src");
const ALLOWLIST = join(ROOT, "scripts", "design-language-allowlist.json");
const COLOR_PREFIXES =
  "bg|text|border|ring|from|to|via|divide|placeholder|ring-offset|fill|stroke|outline|caret|accent|shadow|decoration";
const TAILWIND_VARIANTS = "(?:[a-z][a-z0-9-]*:)*!?";
const LEGAL_RULE_IDS = new Set();
const INTERACTIVE_TEXT_ICON_PATTERN =
  "(?:x|×|✕|✓|✔|›|‹|←|→|↑|↓|⋯|…|\\.\\.\\.|\\+|＋|-|&times;|&plus;|&minus;|&rarr;|&larr;|&uarr;|&darr;|&hellip;|&rsaquo;|&lsaquo;)";
const INTERACTIVE_TEXT_ICON_RE = new RegExp(
  `(?:>\\s*${INTERACTIVE_TEXT_ICON_PATTERN}\\s*<|\\{\\s*["']${INTERACTIVE_TEXT_ICON_PATTERN}["']\\s*\\})`,
);
const INTERACTIVE_CONTEXT_RE = /<button\b|<a\b|<Link\b|<NavLink\b|role=["']button["']|onClick=/;

const COLOR_FIXTURE_RULES = new Set([
  "retired-module-colors",
  "bare-action-blue",
  "bare-status-color",
  "bare-slate-chrome",
  "bare-raw-color",
]);

const RULES = [
  {
    id: "retired-module-colors",
    re: new RegExp(`(--color-mod-|${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-mod-)`),
    msg: "退役模块署名色不得新增或继续消费",
  },
  {
    id: "bare-action-blue",
    re: new RegExp(`\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-(?:blue|sky)-\\d{2,3}(?:\\/\\d+)?\\b`),
    msg: "动作/焦点蓝必须使用 accent token",
  },
  {
    id: "bare-status-color",
    re: new RegExp(
      `\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-(?:emerald|green|amber|yellow|orange|red|rose|gray)-\\d{2,3}(?:\\/\\d+)?\\b`,
    ),
    msg: "状态色必须使用 ok/warn/danger token 或数据色板",
  },
  {
    id: "bare-slate-chrome",
    re: new RegExp(`\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-slate-\\d{2,3}(?:\\/\\d+)?\\b`),
    msg: "UI chrome 必须使用 page/surface/border/ink token",
  },
  {
    id: "bare-raw-color",
    re: /(?:#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lch\(|lab\()/,
    msg: "UI chrome 不得直接写裸 hex/rgb/hsl/oklch/lab 颜色",
    skip: (file, line) => isThemeTokenDeclaration(file, line) || isTokenColorMirror(file),
  },
  {
    id: "interactive-text-icon",
    re: INTERACTIVE_TEXT_ICON_RE,
    msg: "交互图标必须使用 Phosphor Icon",
    skip: (_file, line) => !isInteractiveTextIconLine(line),
  },
  {
    id: "font-mono-business-number",
    re: /\bfont-mono\b/,
    msg: "业务时间/数字/统计值不得直接使用 font-mono，使用 td-num/td-time/td-duration/td-stat",
    skip: (file, line) => isFontMonoTechnicalLine(file, line),
  },
  {
    id: "bare-card-radius",
    re: new RegExp(`\\b${TAILWIND_VARIANTS}rounded-(?:2xl|3xl)\\b`),
    msg: "卡片圆角必须使用 rounded-ctl/row/card token（rounded-2xl/3xl 已并入 --radius 阶梯）",
    skip: (file) => isTestFile(file),
  },
];

for (const rule of RULES) {
  LEGAL_RULE_IDS.add(rule.id);
}

function normalizePath(file) {
  return file.replace(/\\/g, "/");
}

function isTestFile(file) {
  return /\.test\.[jt]sx?$/.test(normalizePath(file));
}

// index.css @theme 里的设计 token 定义本身是颜色的唯一事实源，不算「裸色」。
// 覆盖 --color-* / --galaxy-* 颜色值，以及 --shadow-* 阴影 token（其值含 rgba 但同属 token 定义）。
function isThemeTokenDeclaration(file, line) {
  const normalized = normalizePath(file);
  if (normalized !== "packages/client/src/index.css" && normalized !== "index.css") return false;
  return (
    /^\s*--(?:color|galaxy)-[\w-]+:\s*(?:#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lch\(|lab\()/.test(line) ||
    /^\s*--shadow-[\w-]+:/.test(line)
  );
}

// Token 镜像文件：SVG presentation 属性（recharts）与 SVG data-URI（favicon）都不解析 var()，
// 故这些文件把 index.css 的 --color-* token 镜像成具体 hex 的 JS 常量，是 token 唯一事实源的镜像，
// 不是 UI chrome 裸色。集中登记，便于审计。
const TOKEN_MIRROR_FILES = new Set([
  "packages/client/src/pages/stats/health/chartColors.ts", // --color-data-* / 中性 chrome token
  "packages/client/src/lib/navigation/routeFavicon.ts", // --color-page / --color-ink（favicon SVG data-URI）
]);

function isTokenColorMirror(file) {
  return TOKEN_MIRROR_FILES.has(normalizePath(file));
}

function isFontMonoTechnicalLine(file, line) {
  if (normalizePath(file).endsWith(".css")) return true;
  return /<(?:code|pre|kbd|samp)\b/.test(line);
}

function isInteractiveTextIconLine(line) {
  return INTERACTIVE_CONTEXT_RE.test(line) && INTERACTIVE_TEXT_ICON_RE.test(line);
}

export function classifyLine(file, line) {
  const normalized = normalizePath(file);
  const testFile = isTestFile(normalized);
  const violations = [];

  for (const rule of RULES) {
    if (testFile && (COLOR_FIXTURE_RULES.has(rule.id) || rule.id === "font-mono-business-number")) continue;
    if (rule.skip?.(normalized, line)) continue;
    if (rule.re.test(line)) {
      violations.push({ rule: rule.id, message: rule.msg });
    }
  }

  return violations;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
      continue;
    }
    if (/\.(?:ts|tsx|css)$/.test(name)) files.push(full);
  }
  return files;
}

function normalizeLineText(lineText) {
  return String(lineText ?? "").trim();
}

function allowlistKey({ file, rule, lineText }) {
  return `${rule}:${normalizePath(file)}:${normalizeLineText(lineText)}`;
}

export function loadAllowlist(raw = undefined) {
  const source = raw ?? (existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, "utf8")) : { entries: [] });
  if (source.version !== undefined && source.version !== 1) {
    throw new Error(`scripts/design-language-allowlist.json: unsupported version ${source.version}`);
  }

  const entries = source.entries ?? [];
  if (!Array.isArray(entries)) {
    throw new Error("scripts/design-language-allowlist.json: entries must be an array");
  }

  const counts = new Map();
  entries.forEach((entry, index) => {
    for (const field of ["file", "rule", "lineText", "reason", "ownerBatch", "removeBy"]) {
      if (!entry[field]) {
        throw new Error(`scripts/design-language-allowlist.json: entries[${index}] missing ${field}`);
      }
    }
    if (!LEGAL_RULE_IDS.has(entry.rule)) {
      throw new Error(`scripts/design-language-allowlist.json: entries[${index}] unknown rule ${entry.rule}`);
    }
    const key = allowlistKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return { entries, counts, usedCounts: new Map() };
}

export function isAllowed(file, rule, lineText, allowlist) {
  const key = allowlistKey({ file, rule, lineText });
  const allowedCount = allowlist.counts.get(key) ?? 0;
  const usedCount = allowlist.usedCounts.get(key) ?? 0;
  if (usedCount >= allowedCount) return false;
  allowlist.usedCounts.set(key, usedCount + 1);
  return true;
}

export function collectViolations({ src = SRC, root = ROOT, allowlist = loadAllowlist(), files = null } = {}) {
  const violations = [];
  const inputs =
    files ??
    walk(src).map((full) => ({
      file: normalizePath(relative(root, full)),
      content: readFileSync(full, "utf8"),
    }));

  for (const input of inputs) {
    const rel = normalizePath(input.file);
    const lines = input.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const violation of classifyLineWithContext(rel, line, lines, index)) {
        const lineText = normalizeLineText(line);
        if (isAllowed(rel, violation.rule, lineText, allowlist)) continue;
        violations.push({
          file: rel,
          line: index + 1,
          rule: violation.rule,
          message: violation.message,
          lineText,
        });
      }
    });
  }

  const remainingUsedCounts = new Map(allowlist.usedCounts);
  const staleAllowlist = allowlist.entries.filter((entry) => {
    const key = allowlistKey(entry);
    const usedCount = remainingUsedCounts.get(key) ?? 0;
    if (usedCount <= 0) return true;
    remainingUsedCounts.set(key, usedCount - 1);
    return false;
  });
  return { violations, staleAllowlist };
}

function classifyLineWithContext(file, line, lines, index) {
  const violations = classifyLine(file, line);
  if (violations.some((violation) => violation.rule === "interactive-text-icon")) return violations;
  if (!INTERACTIVE_TEXT_ICON_RE.test(line)) return violations;

  const contextStart = Math.max(0, index - 8);
  const contextEnd = Math.min(lines.length, index + 9);
  const context = lines.slice(contextStart, contextEnd).join("\n");
  if (INTERACTIVE_CONTEXT_RE.test(context)) {
    violations.push({
      rule: "interactive-text-icon",
      message: "交互图标必须使用 Phosphor Icon",
    });
  }
  return violations;
}

function main() {
  const { violations, staleAllowlist } = collectViolations();
  if (violations.length > 0) {
    console.error(
      `✗ 设计语言棘轮闸（新增违规 ${violations.length}）：\n${violations
        .map((violation) => `${violation.file}:${violation.line} ${violation.rule} ${violation.message}`)
        .join("\n")}\n\n旧债请写入 scripts/design-language-allowlist.json，并在对应批次完成后删除。`,
    );
    process.exit(1);
  }
  if (staleAllowlist.length > 0) {
    console.error(
      `✗ 设计语言 allowlist 有 ${staleAllowlist.length} 条已失效，请删除：\n${staleAllowlist
        .map((entry) => `${entry.file} ${entry.rule} ${JSON.stringify(entry.lineText)}`)
        .join("\n")}`,
    );
    process.exit(1);
  }
  console.log("✓ 设计语言：无未豁免裸色 / 退役模块色 / 散装交互图标 / 业务 font-mono");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
