import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages", "client", "src");

// 豁免：ui 原子件（原生控件的受控封装）、测试文件
const EXEMPT_DIRS = [join("components", "ui")];
const isExempt = (rel) => EXEMPT_DIRS.some((e) => rel.includes(e)) || /\.test\.[jt]sx?$/.test(rel);

const PATTERNS = [
  { re: /<select[\s>]/, msg: "原生 <select>（用 SelectSheet / SegmentedControl）" },
  { re: /type=["']checkbox["']/, msg: 'type="checkbox"（用 Checkbox / Switch）' },
  { re: /type=["']radio["']/, msg: 'type="radio"（用 SegmentedControl）' },
  { re: /window\.confirm\(/, msg: "window.confirm（用 useConfirm）" },
  { re: /window\.alert\(/, msg: "window.alert（用轻提示 / ConfirmSheet）" },
];

const violations = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.[jt]sx?$/.test(name)) continue;
    const rel = relative(SRC, full);
    if (isExempt(rel)) continue;
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { re, msg } of PATTERNS) {
        if (re.test(line)) violations.push(`${relative(ROOT, full)}:${i + 1}  ${msg}`);
      }
    });
  }
}
walk(SRC);

if (violations.length > 0) {
  console.error(`✗ 发现原生表单控件（Phase 1 棘轮闸）：\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("✓ 无原生表单控件（select/checkbox/radio/confirm/alert）");
