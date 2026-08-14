#!/usr/bin/env node
// 生成 tauri-plugin-updater 要的 latest.json。
// 用法（CI）: node scripts/updater-manifest.mjs --version 26.814.2 --tag v26081402 \
//              --repo HaiouZh/TimeData --sig-file <path> --out <path>

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function buildUpdaterManifest({ version, tag, repo, signature, pubDate }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`版本号必须是 semver（形如 26.814.2），收到：${JSON.stringify(version)}`);
  }
  if (!tag) throw new Error("tag 不能为空——URL 会拼成指不到任何 Release 的半截地址");
  if (!repo) throw new Error("repo 不能为空——URL 会拼成指不到任何 Release 的半截地址");
  if (!signature || !signature.trim()) {
    throw new Error("签名不能为空：读空的 .sig 会产出一份看着正常、装机验签必失败的 manifest");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pubDate ?? "")) {
    throw new Error(`pub_date 必须是 RFC3339 UTC（形如 2026-08-14T05:51:26Z），收到：${JSON.stringify(pubDate)}`);
  }
  return {
    version,
    // 本仓 Release body 无人工撰写的更新说明，塞进去也没内容可显示。
    notes: "",
    pub_date: pubDate,
    platforms: {
      "windows-x86_64": {
        signature,
        url: `https://github.com/${repo}/releases/download/${tag}/TimeData-Setup.exe`,
      },
    },
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? "" : (process.argv[i + 1] ?? "");
}

function main() {
  const sigFile = arg("sig-file");
  const out = arg("out");
  if (!sigFile || !out) {
    console.error("用法: node scripts/updater-manifest.mjs --version <semver> --tag <tag> --repo <o/r> --sig-file <path> --out <path>");
    process.exit(1);
  }
  const manifest = buildUpdaterManifest({
    version: arg("version"),
    tag: arg("tag"),
    repo: arg("repo"),
    signature: readFileSync(sigFile, "utf8").trim(),
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
