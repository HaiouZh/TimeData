#!/usr/bin/env node
// 把仓库里的 iOS App 图标盖进 CI 现场生成的 Xcode 工程。
// 用法: node scripts/ios-app-icon.mjs <appiconset 目录> <源 png>
//
// 刻意不硬编码模板文件名，改为读 Contents.json 里声明的 filename：
// Capacitor 换模板时会在这里炸出来，而不是产出一个悄悄没图标的包。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveIconFilename(contentsJson) {
  let parsed;
  try {
    parsed = JSON.parse(contentsJson);
  } catch (err) {
    throw new Error(`Contents.json 解析失败：${err.message}`);
  }

  const names = [...new Set((parsed.images ?? []).map((img) => img.filename).filter(Boolean))];
  if (names.length === 0) {
    throw new Error("Contents.json 里没有任何 filename，模板结构已变，请检查 cap add ios 的产物。");
  }
  if (names.length > 1) {
    throw new Error(`Contents.json 声明了多个不同的 filename（${names.join(", ")}），无法确定覆盖目标。`);
  }
  return names[0];
}

export function installAppIcon({ appiconsetDir, sourcePng }) {
  if (!fs.existsSync(appiconsetDir)) {
    throw new Error(`appiconset 目录不存在：${appiconsetDir}`);
  }
  const contentsPath = path.join(appiconsetDir, "Contents.json");
  if (!fs.existsSync(contentsPath)) {
    throw new Error(`Contents.json 不存在：${contentsPath}`);
  }

  const target = path.join(appiconsetDir, resolveIconFilename(fs.readFileSync(contentsPath, "utf8")));
  fs.copyFileSync(sourcePng, target);
  return target;
}

function main() {
  const [appiconsetDir, sourcePng] = process.argv.slice(2);
  if (!appiconsetDir || !sourcePng) {
    console.error("用法: node scripts/ios-app-icon.mjs <appiconset 目录> <源 png>");
    process.exit(1);
  }
  const written = installAppIcon({ appiconsetDir, sourcePng });
  console.log(`iOS App 图标已装配: ${written}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
