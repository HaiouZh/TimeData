import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeTable, ipToU32, normalizeRow } from "./gen-china-geo.mjs";

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

// 截断的中国行以前会被 `?? UNKNOWN` 静默吞并成省-only 条目,绕过「未知写法报错」闸
test("字段不足 7 段的中国行必须抛错", () => {
  assert.throws(() => normalizeRow(["1.0.0.0", "1.0.0.255", "中国", "江苏省"]), /行字段不足 7 段（4）：1\.0\.0\.0\|1\.0\.0\.255\|中国\|江苏省/);
});

// 这道闸是防「下次重跑脚本悄悄引入一个新键、导致已确认范围重报却查不出原因」
test("未知省名必须抛错，不得静默透传", () => {
  assert.throws(() => normalizeRow(row("火星省", "火星市", "移动")), /未知省名.*火星省/);
});

test("未知的英文城市名必须抛错", () => {
  assert.throws(() => normalizeRow(row("江苏省", "Atlantis", "移动")), /未知英文城市名.*Atlantis/);
});

// 2026-08-01 实测:上游把 Cloudflare/Akamai CDN 段写成英文城市名(共 39 个变体),
// 与源数据里的中文主流写法归并,避免生成新收敛键
test("CDN 段的英文城市名归一到主流中文写法", () => {
  assert.equal(normalizeRow(row("广东省", "Shenzhen", "0")).city, "深圳市");
  assert.equal(normalizeRow(row("江苏省", "Tongshan", "0")).city, "徐州市");
  assert.equal(normalizeRow(row("香港特别行政区", "Kowloon", "0")).city, "九龙");
  assert.equal(normalizeRow(row("台湾省", "Taipei City", "0")).city, "台北市");
  assert.equal(normalizeRow(row("台湾省", "Zhongli District", "0")).city, "桃园市");
});

test("ipToU32 按大端换算", () => {
  assert.equal(ipToU32("0.0.0.0"), 0);
  assert.equal(ipToU32("1.0.0.0"), 16777216);
  assert.equal(ipToU32("255.255.255.255"), 4294967295);
});

test("ipToU32 段值超限必须抛错", () => {
  assert.throws(() => ipToU32("1.2.3.999"), /段值超限/);
  assert.throws(() => ipToU32("256.0.0.1"), /段值超限/);
});

test("encodeTable 写出可解析的头部", () => {
  const buf = encodeTable([
    { start: ipToU32("112.25.0.0"), end: ipToU32("112.25.63.255"), province: "江苏省", city: "南京市", isp: "中国移动" },
  ], 20260801);
  assert.equal(buf.subarray(0, 4).toString("ascii"), "TDCN");
  assert.equal(buf.readUInt16BE(4), 1);
  assert.equal(buf.readUInt32BE(6), 20260801);
  assert.equal(buf.readUInt32BE(10), 1);
});

// 3781 个唯一组合 vs 65412 条区间——池化是这张表能压到 750KB 的原因
test("相同地区组合共用一个池条目", () => {
  const entries = [
    { start: 1, end: 2, province: "江苏省", city: "南京市", isp: "中国移动" },
    { start: 3, end: 4, province: "江苏省", city: "南京市", isp: "中国移动" },
    { start: 5, end: 6, province: "江苏省", city: "无锡市", isp: "中国移动" },
  ];
  const buf = encodeTable(entries, 20260801);
  const poolLen = buf.readUInt32BE(14);
  const pool = JSON.parse(buf.subarray(18 + 3 * 10, 18 + 3 * 10 + poolLen).toString("utf8"));
  assert.equal(pool.length, 2);
  assert.equal(buf.readUInt16BE(18 + 0 * 10 + 8), buf.readUInt16BE(18 + 1 * 10 + 8));
  assert.notEqual(buf.readUInt16BE(18 + 0 * 10 + 8), buf.readUInt16BE(18 + 2 * 10 + 8));
});

test("区间按 start 升序写出（二分查找的前提）", () => {
  const buf = encodeTable([
    { start: 100, end: 200, province: "江苏省", city: "南京市", isp: null },
    { start: 1, end: 50, province: "上海", city: "上海市", isp: null },
  ], 20260801);
  assert.equal(buf.readUInt32BE(18), 1);
  assert.equal(buf.readUInt32BE(18 + 10), 100);
});

test("区间重叠时报错——重叠会让二分查找的结果取决于命中顺序", () => {
  assert.throws(() => encodeTable([
    { start: 1, end: 100, province: "江苏省", city: "南京市", isp: null },
    { start: 50, end: 200, province: "上海", city: "上海市", isp: null },
  ], 20260801), /区间重叠/);
});
