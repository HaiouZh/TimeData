import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// 日记日界口径静态闸（源：diary 阶段四终审 L2 / backlog 2026-07）。
// 为什么不用单测锁：本机 TZ=Asia/Taipei、CI 写死 Asia/Shanghai，两者同为 UTC+8，
// 设备本地日界与 Asia/Shanghai 恒等——换成 localDateString 单测照样全绿，只有换时区的真实用户会爆。
// 所以只能按「源码里出现即报错」静态守。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = join(ROOT, "packages", "client", "src");

// 受保护范围：日记域全部代码。pages/DiaryPage*.tsx 在 pages/ 根目录、不在 pages/diary/ 下，单列。
const PROTECTED_DIRS = [join(CLIENT_SRC, "lib", "diary"), join(CLIENT_SRC, "pages", "diary")];
const PROTECTED_FILE_PREFIXES = [join(CLIENT_SRC, "pages", "DiaryPage"), join(CLIENT_SRC, "pages", "settings", "SettingsDiaryPage")];

const BANNED = /localDateString/;

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.[jt]sx?$/.test(name)) files.push(full);
  }
}
for (const dir of PROTECTED_DIRS) if (existsSync(dir)) walk(dir);
for (const prefix of PROTECTED_FILE_PREFIXES) {
  const dir = dirname(prefix);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full.startsWith(prefix) && /\.[jt]sx?$/.test(name)) files.push(full);
  }
}

const violations = [];
for (const full of files) {
  const lines = readFileSync(full, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (BANNED.test(line)) violations.push(`${relative(ROOT, full)}:${i + 1}  ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error(
    [
      "✗ 日记域出现 localDateString（日界口径静态闸）：",
      ...violations,
      "",
      "规矩内核：日记的「今天」恒用 getDateString（lib/time.ts，固定 Asia/Shanghai）。",
      "localDateString 是待办域的设备本地日界，混入日记会让非东八区设备文件名/参考栏整体错一天，",
      "且服务端纯透传不纠偏。单测在 UTC+8 机器上锁不住这条，只有本静态闸能守。",
      "详见 docs/evergreen/diary.md §不变量「日期口径」。",
    ].join("\n"),
  );
  process.exit(1);
}
console.log(`✓ 日记域无 localDateString（扫描 ${files.length} 个文件）`);
