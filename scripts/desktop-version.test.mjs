import assert from "node:assert/strict";
import { test } from "node:test";
import { codeToSemver } from "./desktop-version.mjs";

test("把 8 位版本码转成去前导零的 semver", () => {
  assert.equal(codeToSemver("26080301"), "26.803.1");
});

test("十月之后 MMDD 是四位，不受影响", () => {
  assert.equal(codeToSemver("26121505"), "26.1215.5");
});

test("一月一日的 MMDD 去掉前导零仍单调大于上一年末", () => {
  // 25.1231.1 < 26.101.1：主版本先涨，跨年不会退号
  assert.equal(codeToSemver("25123101"), "25.1231.1");
  assert.equal(codeToSemver("26010101"), "26.101.1");
});

test("当日序号 99 不丢位", () => {
  assert.equal(codeToSemver("26080399"), "26.803.99");
});

test("非 8 位数字直接抛错", () => {
  assert.throws(() => codeToSemver("2608031"), /恰好 8 位数字/);
  assert.throws(() => codeToSemver("v26080301"), /恰好 8 位数字/);
  assert.throws(() => codeToSemver(""), /恰好 8 位数字/);
});
