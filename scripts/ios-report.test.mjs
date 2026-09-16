import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TRANSITION_LANES_MASK,
  buildReport,
  classifyStall,
  dedupeLogs,
  diagnose,
  isBackgroundNoise,
  isStorageSuspect,
  logSql,
  parseArgs,
  percentile,
  renderReport,
  runRemoteQuery,
  sessionMetrics,
  shellQuote,
} from "./ios-report.mjs";

const row = (action, detail, extra = {}) => ({
  id: extra.id ?? 1,
  timestamp: "2026-09-15 10:00:00",
  device: extra.device ?? "iOS",
  action,
  detail: typeof detail === "string" ? detail : JSON.stringify(detail),
});
const withParsed = (r) => ({ ...r, parsed: JSON.parse(r.detail) });

test("掩码常量与 client 的 TRANSITION_LANES_MASK 一致", () => {
  const source = readFileSync(new URL("../packages/client/src/lib/recovery/reactRootProbe.ts", import.meta.url), "utf8");
  const match = source.match(/TRANSITION_LANES_MASK = (\d+)/);
  assert.ok(match);
  assert.equal(Number(match[1]), TRANSITION_LANES_MASK);
});

test("parseArgs：默认 7 天；--days / --json；非法值报错", () => {
  assert.deepEqual(parseArgs([]), { days: 7, json: false });
  assert.deepEqual(parseArgs(["--days", "14", "--json"]), { days: 14, json: true });
  assert.throws(() => parseArgs(["--days", "0"]));
  assert.throws(() => parseArgs(["--days", "abc"]));
  assert.throws(() => parseArgs(["--nope"]));
});

test("shellQuote 处理单引号", () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});

test("runRemoteQuery：SQL 与库路径都加引号走 sqlite3 -readonly -json；空输出为 []", () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, args]);
    return "";
  };
  assert.deepEqual(runRemoteQuery("host", "/data/t.db", logSql(7), exec), []);
  assert.equal(calls[0][0], "ssh");
  const remote = calls[0][1].at(-1);
  assert.match(remote, /^sqlite3 -readonly -json '\/data\/t\.db' '/);
  assert.match(remote, /-7 days/);
  const parsed = runRemoteQuery("host", "/data/t.db", "SELECT 1", () => '[{"a":1}]');
  assert.deepEqual(parsed, [{ a: 1 }]);
});

// 逃逸变异：只按 id 去重 → 没有 id 的旧记录（metaspec §0.2 那条逐字段重复）照样算两次。
test("dedupeLogs：有 id 按 id，无 id 按 device+action+detail 全等", () => {
  const rows = [
    row("open_session", { id: "a", kind: "resume" }),
    row("open_session", { id: "a", kind: "resume", extra: 1 }),
    row("scheduler_probe", { probes: 34, sinceBootMs: 1777603 }),
    row("scheduler_probe", { probes: 34, sinceBootMs: 1777603 }),
    row("scheduler_probe", { probes: 34, sinceBootMs: 1777603 }, { device: "Android" }),
  ];
  const { kept, removed } = dedupeLogs(rows);
  assert.equal(kept.length, 3);
  assert.equal(removed, 2);
  assert.ok(kept.every((r) => r.parsed !== undefined));
});

test("percentile：最近邻 rank；Infinity 排在最慢端；空为 null", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(percentile([1, Number.POSITIVE_INFINITY], 0.9), Number.POSITIVE_INFINITY);
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([null, "x", Number.NaN], 0.5), null);
});

test("isBackgroundNoise：只有 late 且 hidden 算噪声", () => {
  assert.equal(isBackgroundNoise({ outcome: "late", visible: "hidden" }), true);
  assert.equal(isBackgroundNoise({ outcome: "late", visible: "visible" }), false);
  assert.equal(isBackgroundNoise({ outcome: "reload", visible: "hidden" }), false);
});

test("classifyStall：design §2.8 的判定顺序", () => {
  const suspended = { p: 512, s: 512, pg: 0, cb: false, cpc: false };
  assert.equal(classifyStall({ delivered: false, direct: "none", recovered: false }), "甲");
  assert.equal(classifyStall({ delivered: false, direct: "ran", recovered: true }), "甲·直驱救活");
  assert.equal(classifyStall({ delivered: true, rootPost: suspended, lazy: [["TodoPage", 9000]] }), "乙·懒加载");
  assert.equal(classifyStall({ delivered: true, rootPost: suspended, lazy: [] }), "乙·未知挂起源");
  // 挂起 lane 已被清、但没有排着的任务：同样是等 ping 的形状
  assert.equal(classifyStall({ delivered: true, rootPost: { p: 512, s: 0, pg: 0, cb: false, cpc: false }, lazy: [] }), "乙·未知挂起源");
  // 逃逸变异：乙不查 transition 掩码 → 同步 lane 挂着也被判成乙
  assert.equal(classifyStall({ delivered: true, rootPost: { p: 2, s: 2, pg: 0, cb: false, cpc: false }, lazy: [] }), "未定");
  assert.equal(classifyStall({ delivered: true, rootPost: { p: 512, s: 0, pg: 0, cb: true, cpc: false }, lazy: [] }), "未定");
  assert.equal(classifyStall({ delivered: null }), "未定");
});

test("isStorageSuspect：有错误名或库没开", () => {
  assert.equal(isStorageSuspect({ storageErr: "UnknownError", dbOpen: true }), true);
  assert.equal(isStorageSuspect({ storageErr: null, dbOpen: false }), true);
  assert.equal(isStorageSuspect({ storageErr: null, dbOpen: true }), false);
  assert.equal(isStorageSuspect({ storageErr: null, dbOpen: null }), false);
});

test("sessionMetrics：M1 比例、M3 只算 complete/cap 且 cap 缺值记 > 上限、hidden 单列、M4 错误名计数", () => {
  const sessions = [
    { kind: "resume", stall: null, ttiMs: 80, syncMs: 900, endedBy: "complete", storageMs: 20, storageErr: null, dropped: 0, sync: { outcome: "identical" }, net: { connectMs: 200, ttfbMs: 300, xferMs: 10, reused: false } },
    { kind: "resume", stall: "reload", ttiMs: null, syncMs: null, endedBy: "reload", storageMs: null, storageErr: "UnknownError", dropped: 1, sync: null, net: null },
    { kind: "resume", stall: null, ttiMs: 60, syncMs: null, endedBy: "cap", storageMs: 30, storageErr: null, dropped: 0, sync: null, net: null },
    { kind: "resume", stall: null, ttiMs: 50, syncMs: null, endedBy: "hidden", storageMs: 10, storageErr: null, dropped: 0, sync: null, net: null },
    { kind: "cold", stall: null, ttiMs: 400, syncMs: 1500, endedBy: "complete", storageMs: 40, storageErr: null, dropped: 2, sync: { outcome: "pull_only" }, net: null },
  ].map((detail, i) => withParsed(row("open_session", { id: `s${i}`, ...detail })));

  const m = sessionMetrics(sessions);
  assert.equal(m.sessions, 5);
  assert.deepEqual(m.m1, { resumes: 4, reload: 1, held: 0, recovered: 0, rate: 0.25 });
  assert.equal(m.m2.resume.p50, 60);
  assert.equal(m.m2.cold.p50, 400);
  assert.equal(m.m3.n, 3); // complete 900 / 1500 + cap 记为 Infinity
  assert.equal(m.m3.p90, Number.POSITIVE_INFINITY);
  assert.equal(m.m3.hiddenEnded, 1);
  assert.equal(m.m3.connectMs.p50, 200);
  assert.deepEqual(m.m4.byName, { UnknownError: 1 });
  assert.equal(m.m4.rate, 0.2);
  assert.equal(m.dropped, 3);
});

test("diagnose：只统计带诊断字段的记录，旧记录单列；未定过半给出证伪提示", () => {
  const probes = [
    { outcome: "reload", delivered: false, direct: "none", paired: true, storageErr: "UnknownError" },
    { outcome: "reload", delivered: null, paired: false },
    { outcome: "reload", delivered: null, paired: false },
    { outcome: "reload", hadPort: true, kicked: true }, // 旧记录：无 paired 字段
  ].map((detail, i) => withParsed(row("scheduler_probe", { id: `p${i}`, ...detail })));

  const d = diagnose(probes);
  assert.equal(d.withDiag, 3);
  assert.equal(d.legacy, 1);
  assert.deepEqual(d.classes, { 甲: 1, 未定: 2 });
  assert.deepEqual(d.storageByClass, { 甲: 1 });
  assert.equal(d.undecidedMajority, true);
  assert.equal(d.unpairedMajority, true);
});

test("buildReport：按 build · device 分组、剔除后台噪声、网络对照、数据质量", () => {
  const logs = [
    row("open_session", { id: "s1", build: "b1", kind: "resume", stall: null, ttiMs: 50, syncMs: 800, endedBy: "complete", storageMs: 9, storageErr: null, dropped: 0, sync: { outcome: "identical" }, net: null }),
    row("open_session", { id: "s2", build: "b2", kind: "resume", stall: "reload", ttiMs: null, syncMs: null, endedBy: "reload", storageMs: null, storageErr: null, dropped: 0, sync: null, net: null }),
    row("scheduler_probe", { id: "p1", build: "b2", outcome: "reload", delivered: false, direct: "none", paired: true, probes: 10 }),
    row("scheduler_probe", { id: "p2", build: "b2", outcome: "late", visible: "hidden", probes: 14 }),
    // 没带构建号的旧记录不能掉进别的构建里——它们是升级前的现场，混进来会把新包的数字拖脏
    row("open_session", { id: "s3", kind: "cold", stall: null, ttiMs: 700, syncMs: null, endedBy: "hidden", storageMs: 5, storageErr: null, dropped: 0, sync: null, net: null }),
    row("phase_timings", { status: 1800, pull: 800 }),
  ];
  const requests = [{ device_label: "ios", path: "/api/sync/status", duration_ms: 9, timestamp: "2026-09-15T10:00:00Z" }];
  const report = buildReport({ logs, requests });

  assert.deepEqual(report.groups.map((g) => g.key), ["b1 · iOS", "b2 · iOS", "未知构建 · iOS"]);
  assert.equal(report.diagnosis.length, 1);
  assert.deepEqual(report.diagnosis[0].classes, { 甲: 1 });
  assert.equal(report.quality.backgroundNoise, 1);
  assert.equal(report.quality.probeSpan.iOS, 4);
  assert.equal(report.network.client.status.p50, 1800);
  assert.equal(report.network.server.status.p50, 9);

  const text = renderReport(report, { days: 7 });
  assert.match(text, /## M1 卡死率/);
  assert.match(text, /## 卡死诊断/);
  assert.match(text, /b2 · iOS/);
});
