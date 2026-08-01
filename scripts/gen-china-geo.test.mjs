import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRow } from "./gen-china-geo.mjs";

const row = (province, city, isp) => ["1.0.0.0", "1.0.0.255", "中国", province, city, isp, "CN"];

test("非中国行返回 null", () => {
  assert.equal(normalizeRow(["1.0.0.0", "1.0.0.255", "Australia", "Queensland", "0", "0", "AU"]), null);
});

test("多数派写法原样通过", () => {
  assert.deepEqual(normalizeRow(row("江苏省", "南京市", "移动")), { province: "江苏省", city: "南京市", isp: "中国移动" });
});

// 直辖市：源数据里 3799 条写「北京」、45 条写「北京市」，不归一会变成两个收敛键
test("省的全称归一到多数派简称", () => {
  assert.equal(normalizeRow(row("北京市", "Beijing", "联通")).province, "北京");
  assert.equal(normalizeRow(row("宁夏回族自治区", "银川市", "电信")).province, "宁夏");
  assert.equal(normalizeRow(row("广西壮族自治区", "Nanning Shi", "电信")).province, "广西");
});

test("少数派条目的英文城市名归一为中文", () => {
  assert.equal(normalizeRow(row("北京市", "Beijing", "联通")).city, "北京市");
  assert.equal(normalizeRow(row("广西壮族自治区", "Nanning Shi", "电信")).city, "南宁市");
});

test("拼写错误 UEruemqi 归一为新疆", () => {
  assert.deepEqual(normalizeRow(row("UEruemqi", "Wulumuqi", "电信")), { province: "新疆", city: "乌鲁木齐市", isp: "中国电信" });
});

// 源数据把台湾的市直接放在省位置，且市位是英文；以省位的值为准
test("台湾城市出现在省位时，省归一为台湾省、原值移到市位", () => {
  assert.deepEqual(normalizeRow(row("桃园市", "Taipei City", "0")), { province: "台湾省", city: "桃园市", isp: null });
});

test("运营商归一到四大，其余原样透传", () => {
  assert.equal(normalizeRow(row("江苏省", "南京市", "移动")).isp, "中国移动");
  assert.equal(normalizeRow(row("江苏省", "南京市", "中移铁通")).isp, "中国移动");
  assert.equal(normalizeRow(row("江苏省", "南京市", "铁通")).isp, "中国移动");
  assert.equal(normalizeRow(row("江苏省", "南京市", "联通")).isp, "中国联通");
  assert.equal(normalizeRow(row("江苏省", "南京市", "电信")).isp, "中国电信");
  assert.equal(normalizeRow(row("江苏省", "南京市", "阿里云")).isp, "阿里云");
});

test("0 视为未知：市与运营商为 null", () => {
  assert.deepEqual(normalizeRow(row("香港特别行政区", "0", "0")), { province: "香港特别行政区", city: null, isp: null });
});

test("省为 0 时整行按未知丢弃（返回 null）", () => {
  assert.equal(normalizeRow(row("0", "0", "0")), null);
});

// 这道闸是防「下次重跑脚本悄悄引入一个新键、导致已确认范围重报却查不出原因」
test("未知省名必须抛错，不得静默透传", () => {
  assert.throws(() => normalizeRow(row("火星省", "火星市", "移动")), /未知省名.*火星省/);
});

test("未知的英文城市名必须抛错", () => {
  assert.throws(() => normalizeRow(row("江苏省", "Atlantis", "移动")), /未知英文城市名.*Atlantis/);
});
