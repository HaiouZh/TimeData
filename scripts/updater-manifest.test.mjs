import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpdaterManifest } from "./updater-manifest.mjs";

const OK = {
  version: "26.814.2",
  tag: "v26081402",
  repo: "HaiouZh/TimeData",
  signature: "dW50cnVzdGVkIGNvbW1lbnQ6...",
  pubDate: "2026-08-14T05:51:26Z",
};

test("产出 tauri updater 认的结构", () => {
  const m = buildUpdaterManifest(OK);
  assert.equal(m.version, "26.814.2");
  assert.equal(m.notes, "");
  assert.equal(m.pub_date, "2026-08-14T05:51:26Z");
  assert.equal(
    m.platforms["windows-x86_64"].url,
    "https://github.com/HaiouZh/TimeData/releases/download/v26081402/TimeData-Setup.exe",
  );
  assert.equal(m.platforms["windows-x86_64"].signature, OK.signature);
});

// 这一条是本脚本存在的首要理由：.sig 读空会产出一份「看着正常、装机验签必失败」的
// json，而失败要等到用户点更新那一刻才暴露。必须在产出前就炸。
test("签名为空直接抛错，不产出废 manifest", () => {
  assert.throws(() => buildUpdaterManifest({ ...OK, signature: "" }), /签名/);
  assert.throws(() => buildUpdaterManifest({ ...OK, signature: "   " }), /签名/);
});

test("版本号缺失或非 semver 抛错", () => {
  assert.throws(() => buildUpdaterManifest({ ...OK, version: "" }), /版本号/);
  assert.throws(() => buildUpdaterManifest({ ...OK, version: "26081402" }), /版本号/);
});

test("tag 或 repo 缺失抛错（URL 会拼成半截）", () => {
  assert.throws(() => buildUpdaterManifest({ ...OK, tag: "" }), /tag/);
  assert.throws(() => buildUpdaterManifest({ ...OK, repo: "" }), /repo/);
});

test("pub_date 必须是 RFC3339 的 Z 结尾形态", () => {
  assert.throws(() => buildUpdaterManifest({ ...OK, pubDate: "2026-08-14" }), /pub_date/);
});
