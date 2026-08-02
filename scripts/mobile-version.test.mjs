import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { computeVersionCode, parseTagInput, todayInShanghai } from "./mobile-version.mjs";

test("当天还没有任何 tag 时从 01 起", () => {
  assert.equal(computeVersionCode({ today: "260801", existingTags: [] }), "26080101");
});

// 切换日的核心防线：只数 v* 会让新号退到已发布的 android-* 之下，
// 客户端 Number 比较后判定「没有新版本」，所有人收不到更新。
test("序号跨 v- 与 android- 两种前缀计数", () => {
  const tags = ["android-26080101", "android-26080102"];
  assert.equal(computeVersionCode({ today: "260801", existingTags: tags }), "26080103");
});

test("两种前缀混用时取全局最大序号 +1", () => {
  const tags = ["android-26080101", "v26080102"];
  assert.equal(computeVersionCode({ today: "260801", existingTags: tags }), "26080103");
});

// 取最大值而不是数数量：中途删过 tag 时数数量会算出已被占用的号，
// 撞上 gh release create 失败，或更糟——号比线上版本小。
test("中间的 tag 被删过也不退号", () => {
  assert.equal(computeVersionCode({ today: "260801", existingTags: ["v26080103"] }), "26080104");
});

test("其它日期的 tag 不参与计数", () => {
  const tags = ["v26073199", "android-26080201"];
  assert.equal(computeVersionCode({ today: "260801", existingTags: tags }), "26080101");
});

// 现行 workflow 的 printf "%02d" 100 会吐出 100，版本号变 9 位，
// 把最早那批只认 \d{8} 的客户端打挂。宁可让 CI 红。
test("序号超过 99 时报错而不是产出 9 位号", () => {
  assert.throws(() => computeVersionCode({ today: "260801", existingTags: ["v26080199"] }), /99/);
});

// UTC 16:30 在上海已是次日 00:30。用 UTC 会算出 260801。
test("日期按 Asia/Shanghai 而不是 UTC", () => {
  assert.equal(todayInShanghai(new Date("2026-08-01T16:30:00Z")), "260802");
  assert.equal(todayInShanghai(new Date("2026-08-01T15:59:00Z")), "260801");
});

test("parseTagInput 接受 v + 8 位数字", () => {
  assert.equal(parseTagInput("v26080101"), "26080101");
});

test("parseTagInput 拒绝 9 位、缺 v 前缀和 android- 前缀", () => {
  assert.throws(() => parseTagInput("v260801011"), /8 位/);
  assert.throws(() => parseTagInput("26080101"), /8 位/);
  assert.throws(() => parseTagInput("android-26080101"), /8 位/);
});

// --tag 出现但后面没值（如 workflow_dispatch 留空、shell 把空串传进来）时
// 必须报错退出，不能静默落到「算新版本号」分支——补包误发成新发版。
test("--tag 缺值时报错退出而不是静默算新号", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, ["scripts/mobile-version.mjs", "--tag"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    { status: 1 },
  );
});
