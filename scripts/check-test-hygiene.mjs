import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { CLEAN_BUCKET_DIRS, DIRTY_MARKERS, resolveFastJsdomBucket } from "../packages/client/test-buckets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages", "client", "src");
const BASELINE = join(ROOT, "scripts", "test-hygiene-baseline.json");

// 仅扫测试文件。
const isTest = (rel) => /\.test\.[jt]sx?$/.test(rel);

// 干净桶目录（相对 src）：dirty-in-clean-bucket 规则只在此范围生效，唯一事实源在 test-buckets.mjs。
// "src" → ""（全 src 范围，prefix 为空时视全体在内）；"src/lib" → "lib"。
const CLEAN_DIR_PREFIXES = CLEAN_BUCKET_DIRS.map((d) => d.replace(/^src\/?/, ""));
const inCleanBucketDir = (rel) => CLEAN_DIR_PREFIXES.some((p) => p === "" || rel === p || rel.startsWith(`${p}/`));

// jsdom 快桶 allowlist 成员（相对 src）。它们在 isolate:false 下跑，必须走 domHarness（无裸 createRoot，
// 保证自动 unmount）且不直接碰 fake-indexeddb/auto 或 db.delete（走 dbReset，不重建 schema）。
const FAST_JSDOM = new Set(resolveFastJsdomBucket(join(ROOT, "packages", "client")).map((p) => p.replace(/^src\//, "")));

// 测试卫生反模式。文件级棘轮：存量整文件进 baseline 豁免，禁新增同类文件；
// 存量文件修完后从 baseline 删对应 id:path（或跑 --prune），闸自动收紧、不可回退。
const RULES = [
  {
    id: "real-timer-wait",
    re: /setTimeout\([a-zA-Z]+,\s*[1-9]/,
    msg: "真实定时等待（用 vi.useFakeTimers + advanceTimersByTime；纯让位异步用 setTimeout(0)）",
  },
  {
    id: "bare-createroot",
    re: /from ["']react-dom\/client["']/,
    msg: "测试里裸 createRoot（统一走 src/test/domHarness）",
  },
];

const toPosix = (p) => p.replace(/\\/g, "/");

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

/**
 * 写模式的红线：登记必须是**明确指名**的，不能"把当前工作树里的违规全收了"。
 * 旧的 --write-baseline 就是后者——任何人跑一次，都会把别人正在做的、本不该豁免的违规一并收编，
 * 而 diff 里只表现为基线多了几行，review 极易放过。这是"棘轮只紧不松"的唯一破口，已实际误导过人。
 *
 *   --add <路径>        只登记该文件/目录下的违规，合并进现有基线（绝不删已有条目）
 *   --prune             只删除"基线里有但已不再违规"的条目（洗白路径，绝不新增）
 *   --rewrite-baseline  整体重写（保留能力，但会逐条打印新收编了什么，不再静默）
 */
export function parseArgs(argv) {
  let mode = "check";
  const targets = [];
  const setMode = (next) => {
    if (mode !== "check" && mode !== next) throw new CliUsageError("--add / --prune / --rewrite-baseline 只能用一个");
    mode = next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prune") {
      setMode("prune");
      continue;
    }
    if (arg === "--rewrite-baseline") {
      setMode("rewrite");
      continue;
    }
    if (arg === "--add" || arg.startsWith("--add=")) {
      setMode("add");
      const value = arg.startsWith("--add=") ? arg.slice("--add=".length) : argv[++i];
      if (!value) throw new CliUsageError("--add 需要一个路径参数，如 --add packages/client/src/pages/Foo.test.tsx");
      targets.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (arg === "--write-baseline") {
      throw new CliUsageError(
        "--write-baseline 已移除：它按当前工作树整体覆盖写，会把与本次改动无关的违规一并收编、静默放松棘轮。\n" +
          "  登记单条：--add <路径>（可重复，也可逗号分隔）\n" +
          "  洗白已修好的文件：--prune\n" +
          "  确需整体重写：--rewrite-baseline（会逐条打印新收编了什么）",
      );
    }
    throw new CliUsageError(`未知参数：${arg}`);
  }
  if (mode === "add" && targets.length === 0) throw new CliUsageError("--add 需要一个路径参数");
  return { mode, targets };
}

/** 用户给的路径（复制自报错行 / 绝对路径 / 反斜杠 / src 相对）一律归一成 baseline key 里的 src 相对路径。 */
export function toBucketPath(input) {
  const norm = toPosix(input).replace(/^\.\//, "").replace(/\/+$/, "");
  const marker = "packages/client/src/";
  const at = norm.indexOf(marker);
  if (at >= 0) return norm.slice(at + marker.length);
  if (norm === "packages/client/src" || norm.endsWith("/packages/client/src")) return "";
  if (norm.startsWith("src/")) return norm.slice(4);
  return norm;
}

const pathOfKey = (key) => key.slice(key.indexOf(":") + 1);

/**
 * 从全部违规 key 里挑出落在指定路径（文件或目录前缀）下的那些——"只登记我这一条"的实现。
 * 空目标（= 整个 src 根）不予受理：那正是被移除的全树收编，要整体重写请显式用 --rewrite-baseline。
 */
export function selectKeys(keys, targets) {
  const wanted = targets.map(toBucketPath);
  if (wanted.some((t) => t === "")) throw new CliUsageError("--add 不接受整个 src 根目录；要整体重写请用 --rewrite-baseline");
  return keys.filter((key) => {
    const p = pathOfKey(key);
    return wanted.some((t) => p === t || p.startsWith(`${t}/`));
  });
}

/** 只增不删：已有条目原样保留（棘轮只紧不松，别人正在还的债不能被我这次登记顺手抹掉）。 */
export function mergeBaseline(existing, additions) {
  return [...new Set([...existing, ...additions])].sort();
}

/** 洗白：删掉"基线里有但现在已不违规"的条目，不新增任何条目。 */
export function pruneBaseline(existing, currentKeys) {
  const current = new Set(currentKeys);
  const kept = existing.filter((key) => current.has(key));
  const removed = existing.filter((key) => !current.has(key));
  return { next: [...new Set(kept)].sort(), removed };
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

/** 扫全树，产出违规明细（key = 文件级棘轮的 id:src相对路径）。不读基线、不做过滤，纯采集。 */
export function collectFindings({ src = SRC, root = ROOT, fastJsdom = FAST_JSDOM } = {}) {
  const findings = [];
  const push = (key, display, message) => findings.push({ key, display, message });
  walk(src, (full) => {
    const rel = toPosix(relative(src, full));
    if (!isTest(rel)) return;
    const display = toPosix(relative(root, full));
    const content = readFileSync(full, "utf8");
    content.split("\n").forEach((line, i) => {
      for (const { id, re, msg } of RULES) {
        if (re.test(line)) push(`${id}:${rel}`, `${display}:${i + 1}`, `[${id}] ${msg}`);
      }
    });
    // 文件级：干净桶目录(lib/quick-notes)里命中脏标记(db/DOM)的文件会被排出 unit-clean、留在 isolate:true 的 unit 桶。
    // 棘轮记录为存量还债项，禁新增——防新脏文件以为进了快桶其实没进，并提示洗白对象。
    if (inCleanBucketDir(rel) && DIRTY_MARKERS.some((re) => re.test(content))) {
      push(
        `dirty-in-clean-bucket:${rel}`,
        display,
        "[dirty-in-clean-bucket] 干净桶目录里的脏文件(db/DOM 依赖)，会留在 unit 桶；" +
          `如确为脏文件用 --add ${display} 单条收编，或去掉依赖以进 unit-clean 快桶`,
      );
    }
    // jsdom 快桶 allowlist 成员守护：裸 createRoot 会在 isolate:false 下漏 root/DOM（全局 bare-createroot
    // 对存量豁免文件不拦，这里对 allowlist 成员严守）；直接 fake-idb/db.delete 会漏 db 态或重建 schema。
    if (fastJsdom.has(rel)) {
      if (/from ["']react-dom\/client["']/.test(content)) {
        push(
          `bare-createroot-in-fast-jsdom:${rel}`,
          display,
          "[bare-createroot-in-fast-jsdom] 快桶 allowlist 成员含裸 createRoot；改走 src/test/domHarness 自动 unmount",
        );
      }
      if (/import\s+["']fake-indexeddb\/auto["']/.test(content) || /\bdb\.delete\(/.test(content)) {
        push(
          `unsafe-db-in-fast:${rel}`,
          display,
          "[unsafe-db-in-fast] 快桶 allowlist 成员直接 import fake-indexeddb/auto 或用 db.delete(；改走 src/test/dbReset",
        );
      }
    }
  });
  return findings;
}

export const keysOf = (findings) => [...new Set(findings.map((f) => f.key))].sort();

function readBaseline(baselinePath) {
  return existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : [];
}

function writeBaseline(baselinePath, entries) {
  writeFileSync(baselinePath, `${JSON.stringify(entries, null, 2)}\n`);
}

export function run(argv, { src = SRC, root = ROOT, baselinePath = BASELINE, log = console.log, error = console.error } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof CliUsageError)) throw err;
    error(`✗ ${err.message}`);
    return err.exitCode;
  }

  const findings = collectFindings({ src, root });
  const keys = keysOf(findings);
  const existing = readBaseline(baselinePath);
  const relBaseline = toPosix(relative(root, baselinePath));

  if (args.mode === "add") {
    let selected;
    try {
      selected = selectKeys(keys, args.targets);
    } catch (err) {
      if (!(err instanceof CliUsageError)) throw err;
      error(`✗ ${err.message}`);
      return err.exitCode;
    }
    if (selected.length === 0) {
      error(`✗ 指定路径下没有发现任何违规（路径写错了？或者它本来就是干净的）：\n${args.targets.map((t) => `  ${t}`).join("\n")}`);
      return 1;
    }
    const added = selected.filter((key) => !existing.includes(key));
    const next = mergeBaseline(existing, selected);
    writeBaseline(baselinePath, next);
    if (added.length === 0) log(`✓ 指定路径的违规已在基线里，未新增条目（${relBaseline} 共 ${next.length} 条）`);
    else log(`✓ 登记 ${added.length} 条存量豁免 → ${relBaseline}（共 ${next.length} 条）：\n${added.map((k) => `  + ${k}`).join("\n")}`);
    return 0;
  }

  if (args.mode === "prune") {
    const { next, removed } = pruneBaseline(existing, keys);
    if (removed.length === 0) {
      log(`✓ 基线里没有已失效条目，无需洗白（${relBaseline} 共 ${existing.length} 条）`);
      return 0;
    }
    writeBaseline(baselinePath, next);
    log(`✓ 洗白 ${removed.length} 条已不再违规的条目 → ${relBaseline}（剩 ${next.length} 条）：\n${removed.map((k) => `  - ${k}`).join("\n")}`);
    return 0;
  }

  if (args.mode === "rewrite") {
    const added = keys.filter((key) => !existing.includes(key));
    const dropped = existing.filter((key) => !keys.includes(key));
    writeBaseline(baselinePath, keys);
    log(`✓ 整体重写基线 → ${relBaseline}（共 ${keys.length} 条）`);
    if (dropped.length > 0) log(`  洗白（不再违规）${dropped.length} 条：\n${dropped.map((k) => `  - ${k}`).join("\n")}`);
    if (added.length > 0) {
      log(
        `⚠️ 新收编 ${added.length} 条违规——棘轮在这里被放松了，逐条确认都是本次改动应得的豁免，` +
          `否则改用 --add <路径> 只登记你自己的那条：\n${added.map((k) => `  + ${k}`).join("\n")}`,
      );
    }
    return 0;
  }

  const baseline = new Set(existing);
  const violations = findings.filter((f) => !baseline.has(f.key)).map((f) => `${f.display}  ${f.message}`);
  if (violations.length > 0) {
    error(
      `✗ 测试卫生棘轮闸（新增违规 ${violations.length}）：\n${violations.join("\n")}\n\n` +
        `存量还债清单在 ${relBaseline}。确属存量、这次不修的，用 \`node scripts/check-test-hygiene.mjs --add <路径>\` 单条登记` +
        `（只收编你指定的路径，不会顺手收编工作树里别的违规）；修好某文件后从基线删对应 id:path 或跑 --prune，闸自动收紧、不可回退。`,
    );
    return 1;
  }
  log("✓ 测试卫生：无新增真实等待 / 裸 createRoot / 干净桶混入脏文件");
  return 0;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exit(run(process.argv.slice(2)));
}
