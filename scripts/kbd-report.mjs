#!/usr/bin/env node
/**
 * 键盘探针报告（mobile-keyboard R7，design §2.5）。
 *
 * 只读生产库出报告，不写任何东西。取数复用 ios-report.mjs 的 ssh + `sqlite3 -readonly -json` 一条路，
 * 只取 `action = 'kbd_session'`。口径写死在这里，两次报告可比：按（构建 · 设备 · 平台 · 页面）分组，
 * 每条会话一行时间线（相邻事件的毫秒增量 + scrollY / vv.offsetTop 非零标记），组末给 dur / ff 的 p50 / p90。
 *
 * 读法：ff（事件到下一帧的毫秒）> 50 = 主线程被同帧的重排 / 脚本堵住；dur 是这台机系统键盘动画的
 * 真实时长（did − will），与 mo（本次输入条用的时长）对不上就是「一快一慢露空白」的来源；
 * ws 那一格带 sy（scrollY）≠ 0 = 引擎在滚文档（iOS 「页面先上滑」的证据）。
 *
 * 用法：
 *   TIMEDATA_PROD_SSH=<ssh 目标> TIMEDATA_PROD_DB=<生产库路径> node scripts/kbd-report.mjs [--days 7]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRemoteQuery } from "./ios-report.mjs";

const DAYS_MIN = 1;
const DAYS_MAX = 90;

/** ssh 目标以 `-` 开头会被 ssh 当成选项（`-oProxyCommand=…` 即以操作者身份执行本地命令），拒收。 */
export function validateSshTarget(target) {
  if (typeof target !== "string" || target.length === 0 || target.startsWith("-")) {
    throw new Error("ssh 目标非法：不能为空、不能以 - 开头（会被 ssh 当成选项）");
  }
  return target;
}

export function parseArgs(argv) {
  let days = 7;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days") {
      const raw = argv[i + 1];
      i += 1;
      if (!/^\d+$/.test(raw ?? "")) throw new Error(`--days 要一个整数，收到：${String(raw)}`);
      days = Math.min(DAYS_MAX, Math.max(DAYS_MIN, Number(raw)));
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return { days };
}

export function kbdSql(days) {
  return (
    "SELECT id, timestamp, device, action, detail FROM sync_logs" +
    ` WHERE timestamp >= datetime('now','-${days} days') AND action = 'kbd_session'` +
    " ORDER BY id"
  );
}

/** 坏 JSON / 非 v1 / 没有 ev 的行跳过；其余带上设备与落库时间。 */
export function parseRows(rows) {
  const out = [];
  for (const r of rows) {
    let s;
    try {
      s = JSON.parse(r.detail);
    } catch {
      continue;
    }
    if (s?.v !== 1 || !Array.isArray(s.ev)) continue;
    out.push({ id: r.id, at: r.timestamp, device: r.device ?? "?", session: s });
  }
  return out;
}

const fmt = (v) => (v === null || v === undefined ? "-" : String(v));

export function renderTimeline({ session: s }) {
  const parts = [];
  let prev = null;
  for (const [type, t, sy, vo] of s.ev) {
    const delta = prev === null ? "" : `+${t - prev}`;
    const marks = [sy ? `sy${sy}` : "", vo ? `vo${vo}` : ""].filter(Boolean).join(",");
    parts.push(`${type}${delta}${marks ? `(${marks})` : ""}`);
    prev = t;
  }
  const tail = [
    `ff=${fmt(s.ff?.[0])}/${fmt(s.ff?.[1])}`,
    `dur=${fmt(s.dur?.[0])}/${fmt(s.dur?.[1])}`,
    `mo=${s.mo?.[0]}/${s.mo?.[1]} ${s.mo?.[2]}`,
    `nav=${s.nav}`,
    `kh=${s.kh}`,
    `in=${s.in}`,
    s.trunc ? "trunc" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `${parts.join(" → ")}  ${tail}`;
}

export function groupSessions(list) {
  const groups = new Map();
  for (const item of list) {
    const k = `${item.session.b} · ${item.device} · ${item.session.p} · ${item.session.r}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

/** 最近秩分位：与 ios-report 同一种取法（不插值），样本少时不造假数。 */
function percentile(values, q) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.min(v.length - 1, Math.ceil(v.length * q) - 1)];
}

export function summarize(list) {
  const pick = (q) => ({
    dur: [
      percentile(
        list.map((i) => i.session.dur?.[0]),
        q,
      ),
      percentile(
        list.map((i) => i.session.dur?.[1]),
        q,
      ),
    ],
    ff: [
      percentile(
        list.map((i) => i.session.ff?.[0]),
        q,
      ),
      percentile(
        list.map((i) => i.session.ff?.[1]),
        q,
      ),
    ],
  });
  return { n: list.length, p50: pick(0.5), p90: pick(0.9) };
}

export function renderReport(list, { days }) {
  const lines = [`# 键盘探针报告（最近 ${days} 天，${list.length} 条会话）`, ""];
  if (list.length === 0) {
    lines.push("没有 kbd_session 记录：设置 → 数据 → 高级 · 诊断 打开「键盘探针」，弹几次键盘后同步一次。");
    return lines.join("\n");
  }
  for (const [key, items] of groupSessions(list)) {
    const s = summarize(items);
    const pair = (a) => `${fmt(a[0])}/${fmt(a[1])}`;
    lines.push(`## ${key}`);
    lines.push(
      `n=${s.n} dur p50=${pair(s.p50.dur)} p90=${pair(s.p90.dur)} ff p50=${pair(s.p50.ff)} p90=${pair(s.p90.ff)}`,
    );
    for (const item of items) lines.push(`${item.at}  ${renderTimeline(item)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function main(argv = process.argv.slice(2), env = process.env, io = console) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.error(String(error?.message ?? error));
    return 2;
  }
  const dbPath = env.TIMEDATA_PROD_DB;
  if (!env.TIMEDATA_PROD_SSH || !dbPath) {
    io.error("需要环境变量 TIMEDATA_PROD_SSH（ssh 目标）与 TIMEDATA_PROD_DB（生产库路径）");
    return 2;
  }
  let target;
  try {
    target = validateSshTarget(env.TIMEDATA_PROD_SSH);
  } catch (error) {
    io.error(String(error?.message ?? error));
    return 2;
  }
  const rows = runRemoteQuery(target, dbPath, kbdSql(args.days));
  io.log(renderReport(parseRows(rows), { days: args.days }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
