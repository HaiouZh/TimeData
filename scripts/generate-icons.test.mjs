import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { IOS_ICON_SIZE, generateIos, writeIosAppIcon } from "./generate-icons.mjs";

test("iOS 图标是 1024×1024", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-icon-"));
  const out = path.join(dir, "AppIcon-1024.png");

  await writeIosAppIcon(out);

  const meta = await sharp(out).metadata();
  assert.equal(meta.width, IOS_ICON_SIZE);
  assert.equal(meta.height, IOS_ICON_SIZE);
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

// 入口级接线：generateIos 必须真的产出 AppIcon-1024.png——否则 main() 漏接产线时
// （或写错文件名），writeIosAppIcon 的单测照样全绿，发布却永远没有图标。
test("generateIos 产出 AppIcon-1024.png", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-icon-"));
  await generateIos(dir);

  const out = path.join(dir, "AppIcon-1024.png");
  assert.ok(fs.existsSync(out), "generateIos 应产出 AppIcon-1024.png");
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, IOS_ICON_SIZE);
  assert.equal(meta.hasAlpha, false);
});
