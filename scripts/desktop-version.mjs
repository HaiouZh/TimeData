#!/usr/bin/env node
// 把 mobile-release 的 8 位版本码（YYMMDDNN）转成 Tauri 要的 semver（YY.MMDD.NN）。
// semver 不允许数字段带前导零，故各段一律走 Number() 去零。
// 用法（CI）: node scripts/desktop-version.mjs --code 26080301 >> "$GITHUB_OUTPUT"

import { fileURLToPath } from "node:url";

export function codeToSemver(code) {
  if (!/^\d{8}$/.test(code)) {
    throw new Error(`版本码必须是恰好 8 位数字，收到：${code}`);
  }
  const yy = Number(code.slice(0, 2));
  const mmdd = Number(code.slice(2, 6));
  const nn = Number(code.slice(6, 8));
  return `${yy}.${mmdd}.${nn}`;
}

function main() {
  const codeArgIndex = process.argv.indexOf("--code");
  const rawCode = codeArgIndex === -1 ? "" : (process.argv[codeArgIndex + 1] ?? "");
  if (!rawCode) {
    console.error("用法: node scripts/desktop-version.mjs --code <8 位数字>");
    process.exit(1);
  }
  process.stdout.write(`semver=${codeToSemver(rawCode)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
