import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { CLEAN_BUCKET_DIRS, DIRTY_MARKERS, resolveFastJsdomBucket } from "../packages/client/test-buckets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages", "client", "src");
const BASELINE = join(ROOT, "scripts", "test-hygiene-baseline.json");

// 仅扫测试文件。
const isTest = (rel) => /\.test\.[jt]sx?$/.test(rel);

// 干净桶目录（相对 src）：dirty-in-clean-bucket 规则只在此范围生效，唯一事实源在 test-buckets.mjs。
// "src" → ""（全 src 范围，prefix 为空时视全体在内）；"src/lib" → "lib"。
const CLEAN_DIR_PREFIXES = CLEAN_BUCKET_DIRS.map((d) => d.replace(/^src\/?/, ""));
const inCleanBucketDir = (rel) =>
  CLEAN_DIR_PREFIXES.some((p) => p === "" || rel === p || rel.startsWith(`${p}/`));

// jsdom 快桶 allowlist 成员（相对 src）。它们在 isolate:false 下跑，必须走 domHarness（无裸 createRoot，
// 保证自动 unmount）且不直接碰 fake-indexeddb/auto 或 db.delete（走 dbReset，不重建 schema）。
const FAST_JSDOM = new Set(
  resolveFastJsdomBucket(join(ROOT, "packages", "client")).map((p) => p.replace(/^src\//, "")),
);

// 测试卫生反模式。文件级棘轮：存量整文件进 baseline 豁免，禁新增同类文件；
// 存量文件修完后从 baseline 删对应 id:path，闸自动收紧、不可回退。
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

const writeMode = process.argv.includes("--write-baseline");
const baseline =
  !writeMode && existsSync(BASELINE) ? new Set(JSON.parse(readFileSync(BASELINE, "utf8"))) : new Set();

const violations = []; // 给人看：file:line [id] message
const keys = new Set(); // 文件级 key：id:相对 src 路径

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    const rel = relative(SRC, full).replace(/\\/g, "/");
    if (!isTest(rel)) continue;
    const content = readFileSync(full, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      for (const { id, re, msg } of RULES) {
        if (!re.test(line)) continue;
        const key = `${id}:${rel}`;
        keys.add(key);
        if (!baseline.has(key)) violations.push(`${relative(ROOT, full)}:${i + 1}  [${id}] ${msg}`);
      }
    });
    // 文件级：干净桶目录(lib/quick-notes)里命中脏标记(db/DOM)的文件会被排出 unit-clean、留在 isolate:true 的 unit 桶。
    // 棘轮记录为存量还债项，禁新增——防新脏文件以为进了快桶其实没进，并提示 Stage 3 洗白对象。
    if (inCleanBucketDir(rel) && DIRTY_MARKERS.some((re) => re.test(content))) {
      const key = `dirty-in-clean-bucket:${rel}`;
      keys.add(key);
      if (!baseline.has(key))
        violations.push(
          `${relative(ROOT, full)}  [dirty-in-clean-bucket] 干净桶目录里的脏文件(db/DOM 依赖)，会留在 unit 桶；` +
            `如确为脏文件用 --write-baseline 收编，或去掉依赖以进 unit-clean 快桶`,
        );
    }
    // jsdom 快桶 allowlist 成员守护：裸 createRoot 会在 isolate:false 下漏 root/DOM（全局 bare-createroot
    // 对存量豁免文件不拦，这里对 allowlist 成员严守）；直接 fake-idb/db.delete 会漏 db 态或重建 schema。
    if (FAST_JSDOM.has(rel)) {
      if (/from ["']react-dom\/client["']/.test(content)) {
        const key = `bare-createroot-in-fast-jsdom:${rel}`;
        keys.add(key);
        if (!baseline.has(key))
          violations.push(
            `${relative(ROOT, full)}  [bare-createroot-in-fast-jsdom] 快桶 allowlist 成员含裸 createRoot；改走 src/test/domHarness 自动 unmount`,
          );
      }
      if (/import\s+["']fake-indexeddb\/auto["']/.test(content) || /\bdb\.delete\(/.test(content)) {
        const key = `unsafe-db-in-fast:${rel}`;
        keys.add(key);
        if (!baseline.has(key))
          violations.push(
            `${relative(ROOT, full)}  [unsafe-db-in-fast] 快桶 allowlist 成员直接 import fake-indexeddb/auto 或用 db.delete(；改走 src/test/dbReset`,
          );
      }
    }
  }
}
walk(SRC);

if (writeMode) {
  const sorted = [...keys].sort();
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`✓ 写入 baseline：${sorted.length} 条存量豁免 → ${relative(ROOT, BASELINE)}`);
  process.exit(0);
}

if (violations.length > 0) {
  console.error(
    `✗ 测试卫生棘轮闸（新增违规 ${violations.length}）：\n${violations.join("\n")}\n\n` +
      `存量还债清单在 ${relative(ROOT, BASELINE)}；修复某文件后从 baseline 删对应 id:path，闸自动收紧、不可回退。`,
  );
  process.exit(1);
}
console.log("✓ 测试卫生：无新增真实等待 / 裸 createRoot / 干净桶混入脏文件");
