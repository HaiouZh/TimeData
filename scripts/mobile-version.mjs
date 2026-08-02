#!/usr/bin/env node
// 计算移动端发布的版本号与 tag。yymmdd(Asia/Shanghai) + 两位当日序号，共 8 位。
// 用法（CI）: node scripts/mobile-version.mjs >> "$GITHUB_OUTPUT"
//            node scripts/mobile-version.mjs --tag v26080101 >> "$GITHUB_OUTPUT"

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_SEQ = 99;

export function todayInShanghai(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}${get("month")}${get("day")}`;
}

export function computeVersionCode({ today, existingTags }) {
  // 同时认 v- 与 android- 两种前缀：切换期两种 tag 并存，只数一种会退号。
  const pattern = new RegExp(`^(?:v|android-)${today}(\\d{2})$`);
  let maxSeq = 0;
  for (const tag of existingTags) {
    const matched = tag.match(pattern);
    if (matched) maxSeq = Math.max(maxSeq, Number(matched[1]));
  }
  const seq = maxSeq + 1;
  if (seq > MAX_SEQ) {
    throw new Error(`当日序号已达上限 ${MAX_SEQ}，再涨会产出 9 位版本号，打挂只认 8 位的旧客户端。`);
  }
  return `${today}${String(seq).padStart(2, "0")}`;
}

export function parseTagInput(input) {
  const matched = /^v(\d{8})$/.exec(input);
  if (!matched) {
    throw new Error(`tag 必须形如 v + 恰好 8 位数字，收到：${input}`);
  }
  return matched[1];
}

function readGitTags() {
  return execFileSync("git", ["tag", "-l"], { encoding: "utf8" }).split("\n").map((t) => t.trim()).filter(Boolean);
}

function main() {
  const tagArgIndex = process.argv.indexOf("--tag");
  const rawTag = tagArgIndex === -1 ? "" : (process.argv[tagArgIndex + 1] ?? "");
  if (tagArgIndex !== -1 && !rawTag) {
    console.error("用法: node scripts/mobile-version.mjs [--tag v<8 位数字>]（--tag 后必须跟值，缺值会静默算新版本号）");
    process.exit(1);
  }

  const code = rawTag
    ? parseTagInput(rawTag)
    : computeVersionCode({ today: todayInShanghai(new Date()), existingTags: readGitTags() });

  process.stdout.write(`code=${code}\ntag=v${code}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
