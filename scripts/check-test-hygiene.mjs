import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages", "client", "src");
const BASELINE = join(ROOT, "scripts", "test-hygiene-baseline.json");

// 仅扫测试文件。
const isTest = (rel) => /\.test\.[jt]sx?$/.test(rel);

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
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { id, re, msg } of RULES) {
        if (!re.test(line)) continue;
        const key = `${id}:${rel}`;
        keys.add(key);
        if (!baseline.has(key)) violations.push(`${relative(ROOT, full)}:${i + 1}  [${id}] ${msg}`);
      }
    });
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
console.log("✓ 测试卫生：无新增真实等待 / 裸 createRoot");
