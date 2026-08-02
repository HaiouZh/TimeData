import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { generateIos, writeIosAppIcon } from "./generate-icons.mjs";

test("iOS 图标是 1024×1024", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-icon-"));
  const out = path.join(dir, "AppIcon-1024.png");

  await writeIosAppIcon(out);

  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
});

// iOS 不接受带透明通道的 App 图标。源图当前恰好无 alpha，
// 但不能依赖源图属性——sharp 输出 PNG 时仍可能带上，必须显式压掉。
test("iOS 图标不带 alpha 通道", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-icon-"));
  const out = path.join(dir, "AppIcon-1024.png");

  await writeIosAppIcon(out);

  const meta = await sharp(out).metadata();
  assert.equal(meta.hasAlpha, false);
  assert.equal(meta.channels, 3);
});

// 真实源图恰好无 alpha，测不出 .flatten() 的职责；用带 alpha 的现造源图
// 验证输出被压成无通道 PNG（hasAlpha=false 且 channels=3）。
test("iOS 图标压掉源图 alpha（带 alpha 源图也不带出 alpha）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-icon-"));
  const src = path.join(dir, "src-alpha.png");
  const out = path.join(dir, "AppIcon-1024.png");

  await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  })
    .png()
    .toFile(src);
  await writeIosAppIcon(out, src);

  const meta = await sharp(out).metadata();
  assert.equal(meta.hasAlpha, false);
  assert.equal(meta.channels, 3);
});

// 入口级接线：generateIos 必须真的产出 AppIcon-1024.png——否则 main() 漏接产线时
// （或写错文件名），writeIosAppIcon 的单测照样全绿，发布却永远没有图标。
test("generateIos 产出 AppIcon-1024.png", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-icon-"));
  await generateIos(dir);

  const out = path.join(dir, "AppIcon-1024.png");
  assert.ok(fs.existsSync(out), "generateIos 应产出 AppIcon-1024.png");
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.hasAlpha, false);
});
