import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installAppIcon, resolveIconFilename } from "./ios-app-icon.mjs";

// Capacitor 7 模板的形态：单尺寸 1024。
const TEMPLATE_CONTENTS = JSON.stringify({
  images: [{ filename: "AppIcon-512@2x.png", idiom: "universal", scale: "1x", size: "1024x1024" }],
  info: { author: "xcode", version: 1 },
});

function makeAppiconset(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "td-appicon-"));
  fs.writeFileSync(path.join(dir, "Contents.json"), contents);
  return dir;
}

test("从 Contents.json 解析出目标文件名", () => {
  assert.equal(resolveIconFilename(TEMPLATE_CONTENTS), "AppIcon-512@2x.png");
});

test("多个条目指向同一个文件名时正常返回", () => {
  const contents = JSON.stringify({
    images: [
      { filename: "AppIcon-512@2x.png", idiom: "universal", scale: "1x" },
      { filename: "AppIcon-512@2x.png", idiom: "ios-marketing", scale: "1x" },
    ],
  });
  assert.equal(resolveIconFilename(contents), "AppIcon-512@2x.png");
});

// 模板若改成多尺寸切图，盖掉其中一个会产出图标残缺的包。宁可红。
test("出现多个不同文件名时报错", () => {
  const contents = JSON.stringify({
    images: [{ filename: "a.png" }, { filename: "b.png" }],
  });
  assert.throws(() => resolveIconFilename(contents), /多个/);
});

test("没有任何 filename 时报错", () => {
  assert.throws(() => resolveIconFilename(JSON.stringify({ images: [{ idiom: "universal" }] })), /没有/);
});

test("Contents.json 不是合法 JSON 时报错", () => {
  assert.throws(() => resolveIconFilename("{ not json"), /解析/);
});

test("installAppIcon 覆盖模板图标并返回被写路径", () => {
  const dir = makeAppiconset(TEMPLATE_CONTENTS);
  fs.writeFileSync(path.join(dir, "AppIcon-512@2x.png"), "old-template-bytes");
  const src = path.join(dir, "source.png");
  fs.writeFileSync(src, "new-timedata-bytes");

  const written = installAppIcon({ appiconsetDir: dir, sourcePng: src });

  assert.equal(written, path.join(dir, "AppIcon-512@2x.png"));
  assert.equal(fs.readFileSync(written, "utf8"), "new-timedata-bytes");
});

test("appiconset 目录不存在时报错", () => {
  const missing = path.join(os.tmpdir(), "td-appicon-does-not-exist");
  assert.throws(() => installAppIcon({ appiconsetDir: missing, sourcePng: missing }), /不存在/);
});
