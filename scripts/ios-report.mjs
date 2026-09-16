#!/usr/bin/env node
/**
 * iOS 打开体验固定口径报告（ios-instant-open 阶段1 design §6）。
 *
 * 只读生产库出报告，不写任何东西。取数走 ssh + `sqlite3 -readonly`，**口径写死在这个文件里**——
 * 每次临时拼 SQL 会让两次报告没法比，而这个主题的全部判断都建立在「同一口径下数字有没有变」上。
 *
 * 用法：
 *   TIMEDATA_PROD_SSH=<ssh 目标> TIMEDATA_PROD_DB=<生产库路径> \
 *     node scripts/ios-report.mjs [--days 7] [--json]
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 与 packages/client/src/lib/recovery/reactRootProbe.ts 的同名常量一致，测试比对源码防漂。 */
export const TRANSITION_LANES_MASK = 261888;

/** open_session 的封顶时长（design §3）：到顶还没等到新数据，渲染成「> 20 s」而不是丢掉这次。 */
const OPEN_SESSION_CAP_MS = 20000;

const DAYS_MIN = 1;
const DAYS_MAX = 90;

/** 端上 phase_timings 的字段名 ↔ 服务端 api_request_logs 的 path，用来把同一段路的两端摆在一起。 */
const SYNC_PATHS = {
  status: "/api/sync/status",
  pull: "/api/sync/pull",
  push: "/api/sync/push",
};

const LOG_ACTIONS = ["scheduler_probe", "open_session", "phase_timings"];

export function parseArgs(argv) {
  let days = 7;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--days") {
      const raw = argv[i + 1];
      i += 1;
      if (!/^\d+$/.test(raw ?? "")) throw new Error(`--days 要一个整数，收到：${String(raw)}`);
      days = Number(raw);
      if (days < DAYS_MIN || days > DAYS_MAX) throw new Error(`--days 要在 ${DAYS_MIN}..${DAYS_MAX}，收到：${days}`);
      continue;
    }
    throw new Error(`不认识的参数：${arg}`);
  }
  return { days, json };
}

/** 单引号包起来，内部的单引号按 POSIX 惯例断开再拼。SQL 与库路径都要过这一道。 */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function logSql(days) {
  const actions = LOG_ACTIONS.map((a) => `'${a}'`).join(",");
  return (
    "SELECT id, timestamp, device, action, detail FROM sync_logs" +
    ` WHERE timestamp >= datetime('now','-${days} days') AND action IN (${actions})` +
    " ORDER BY id"
  );
}

export function requestSql(days) {
  return (
    "SELECT timestamp, device_label, path, duration_ms FROM api_request_logs" +
    ` WHERE timestamp >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-${days} days')` +
    " ORDER BY timestamp"
  );
}

const defaultExec = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function runRemoteQuery(target, dbPath, sql, exec = defaultExec) {
  const remote = `sqlite3 -readonly -json ${shellQuote(dbPath)} ${shellQuote(sql)}`;
  const text = String(exec("ssh", [target, remote]) ?? "").trim();
  // sqlite3 -json 对空结果集打印空串而不是 []，直接 JSON.parse 会抛。
  if (!text) return [];
  return JSON.parse(text);
}

export function parseDetail(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 去重。有 `id` 的按 id——那是端上 reportId 生成的，同一条报告被 bump/push/pull 三路并发重投时 id 相同。
 * 没有 id 的是阶段1 之前的旧记录，退回按 device|action|detail 全等判重（生产里确实有逐字段一模一样的两条）。
 */
export function dedupeLogs(rows) {
  const seen = new Set();
  const kept = [];
  let removed = 0;
  for (const row of rows) {
    const parsed = parseDetail(row.detail);
    const id = parsed && typeof parsed.id === "string" ? parsed.id : null;
    const key = id ? `id:${id}` : `raw:${row.device}|${row.action}|${row.detail}`;
    if (seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    kept.push({ ...row, parsed: parsed ?? {} });
  }
  return { kept, removed };
}

/**
 * 最近邻 rank（`ceil(q·n)`，至少 1）。**不插值**：插值会把 Infinity 和有限值混算成 NaN，
 * 而「一直没等到」正是这个主题最要看的那一档，必须能原样排到最慢端。
 */
export function percentile(values, q) {
  const nums = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1];
}

const statsOf = (values) => {
  const nums = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  return { n: nums.length, p50: percentile(nums, 0.5), p90: percentile(nums, 0.9) };
};

/** 后台里跑完的那次探针不算用户体感：它没人在看，慢了也没人知道。 */
export function isBackgroundNoise(probe) {
  return probe?.outcome === "late" && probe?.visible === "hidden";
}

/**
 * 卡死分叉判定（design §2.8）。顺序即判据，别调换：
 * - `delivered === false` → 信道没把补拍送回来，是「甲」；补拍后直驱跑起来且救活了，另记一档。
 * - `delivered === true` 而根上还挂着 transition lane、且没有排着的回调 → 消息送到了、React 自己在等，是「乙」。
 * - 其余一律「未定」，包括没有诊断字段的旧记录——**不许往两边硬凑**，未定过半本身就是结论（design §2.8 的证伪条件）。
 */
export function classifyStall(probe) {
  if (probe?.delivered === false) {
    return probe.direct === "ran" && probe.recovered === true ? "甲·直驱救活" : "甲";
  }
  if (probe?.delivered === true) {
    const root = probe.rootPost;
    const stuckTransition = root && (root.p & TRANSITION_LANES_MASK) !== 0 && !root.cb && !root.cpc;
    if (stuckTransition) {
      return Array.isArray(probe.lazy) && probe.lazy.length > 0 ? "乙·懒加载" : "乙·未知挂起源";
    }
  }
  return "未定";
}

/** 丙：本地库是不是同时也在出事。只当交叉维度看，不单独成一类。 */
export function isStorageSuspect(probe) {
  return Boolean(probe?.storageErr) || probe?.dbOpen === false;
}

/**
 * M1–M4 与 dropped。入参是同一组（构建 · 设备）里的 open_session 行。
 *
 * M3 把 `endedBy === "cap"` 的会话记成 Infinity 而不是丢掉——丢掉等于把最糟的那几次从分位数里抹去，
 * 报告会越看越好看。
 */
export function sessionMetrics(rows) {
  const all = rows.map((r) => r.parsed);
  const resumes = all.filter((s) => s.kind === "resume");
  const countStall = (name) => resumes.filter((s) => s.stall === name).length;
  const reload = countStall("reload");
  const held = countStall("held");
  const recovered = countStall("recovered");

  const arrived = all.filter((s) => s.endedBy === "complete" || s.endedBy === "cap");
  const syncValues = arrived.map((s) => (typeof s.syncMs === "number" ? s.syncMs : Number.POSITIVE_INFINITY));
  const netOf = (key) => all.map((s) => (s.net ? s.net[key] : null));

  const errNames = {};
  for (const s of all) {
    if (typeof s.storageErr === "string" && s.storageErr) errNames[s.storageErr] = (errNames[s.storageErr] ?? 0) + 1;
  }
  const errTotal = Object.values(errNames).reduce((a, b) => a + b, 0);

  return {
    sessions: all.length,
    m1: { resumes: resumes.length, reload, held, recovered, rate: resumes.length ? (reload + held) / resumes.length : null },
    m2: {
      resume: statsOf(resumes.map((s) => s.ttiMs)),
      cold: statsOf(all.filter((s) => s.kind === "cold").map((s) => s.ttiMs)),
    },
    m3: {
      ...statsOf(syncValues),
      hiddenEnded: all.filter((s) => s.endedBy === "hidden").length,
      connectMs: statsOf(netOf("connectMs")),
      ttfbMs: statsOf(netOf("ttfbMs")),
      xferMs: statsOf(netOf("xferMs")),
      reused: all.filter((s) => s.net?.reused === true).length,
    },
    m4: {
      byName: errNames,
      rate: all.length ? errTotal / all.length : null,
      storageMs: statsOf(all.map((s) => s.storageMs)),
    },
    dropped: all.reduce((sum, s) => sum + (typeof s.dropped === "number" ? s.dropped : 0), 0),
  };
}

/**
 * 甲乙丙分布。**只统计带 `paired` 字段的记录**：阶段1 之前的 scheduler_probe 没有任何分叉信息，
 * 把它们摊进分母只会让每一类看起来都很小。旧记录单独报条数，好知道数据还要等多久才够看。
 */
export function diagnose(rows) {
  const probes = rows.map((r) => r.parsed).filter((p) => p && typeof p.outcome === "string");
  const withDiag = probes.filter((p) => "paired" in p);
  const classes = {};
  const storageByClass = {};
  for (const p of withDiag) {
    const cls = classifyStall(p);
    classes[cls] = (classes[cls] ?? 0) + 1;
    if (isStorageSuspect(p)) storageByClass[cls] = (storageByClass[cls] ?? 0) + 1;
  }
  const undecided = classes["未定"] ?? 0;
  const unpaired = withDiag.filter((p) => p.paired === false).length;
  return {
    withDiag: withDiag.length,
    legacy: probes.length - withDiag.length,
    classes,
    storageByClass,
    undecidedMajority: withDiag.length > 0 && undecided * 2 > withDiag.length,
    unpairedMajority: withDiag.length > 0 && unpaired * 2 > withDiag.length,
  };
}

/** 同一段同步的两端：端上 phase_timings 的耗时 vs 服务端 api_request_logs 的处理耗时。差额即网络。 */
export function networkCompare(phaseRows, requests) {
  const client = {};
  const server = {};
  for (const [key, path] of Object.entries(SYNC_PATHS)) {
    client[key] = statsOf(phaseRows.map((r) => r.parsed?.[key]));
    server[key] = statsOf(
      requests.filter((q) => q.device_label === "ios" && q.path === path).map((q) => q.duration_ms),
    );
  }
  return { client, server };
}

/**
 * 数据质量。`probeSpan` 是每台设备上 `probes` 计数的最大最小之差：它与实际收到的条数一对比，
 * 就知道有多少条根本没上来——报告里每个数字都建立在「上来的那些」之上，漏报率是读它们的前提。
 */
export function dataQuality(kept, removed, noise) {
  const probes = kept.filter((r) => r.action === "scheduler_probe");
  const spanByDevice = {};
  for (const r of probes) {
    const n = r.parsed?.probes;
    if (typeof n !== "number") continue;
    const cur = spanByDevice[r.device] ?? { min: n, max: n, count: 0 };
    cur.min = Math.min(cur.min, n);
    cur.max = Math.max(cur.max, n);
    cur.count += 1;
    spanByDevice[r.device] = cur;
  }
  const probeSpan = {};
  const probeCount = {};
  for (const [device, v] of Object.entries(spanByDevice)) {
    probeSpan[device] = v.max - v.min;
    probeCount[device] = v.count;
  }
  const builds = [...new Set(kept.map((r) => r.parsed?.build).filter((b) => typeof b === "string"))].sort();
  return {
    total: kept.length,
    duplicates: removed,
    backgroundNoise: noise,
    legacy: probes.filter((r) => !("paired" in (r.parsed ?? {}))).length,
    dropped: kept
      .filter((r) => r.action === "open_session")
      .reduce((sum, r) => sum + (typeof r.parsed?.dropped === "number" ? r.parsed.dropped : 0), 0),
    probeSpan,
    probeCount,
    builds,
  };
}

const groupKey = (row) => `${typeof row.parsed?.build === "string" ? row.parsed.build : "未知构建"} · ${row.device}`;

export function buildReport({ logs, requests }) {
  const { kept, removed } = dedupeLogs(logs);
  const sessions = kept.filter((r) => r.action === "open_session");
  const allProbes = kept.filter((r) => r.action === "scheduler_probe");
  const phases = kept.filter((r) => r.action === "phase_timings");
  const probes = allProbes.filter((r) => !isBackgroundNoise(r.parsed));

  const bucket = (rows) => {
    const map = new Map();
    for (const r of rows) {
      const key = groupKey(r);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };

  return {
    groups: bucket(sessions).map(([key, rows]) => ({ key, ...sessionMetrics(rows) })),
    diagnosis: bucket(probes).map(([key, rows]) => ({ key, ...diagnose(rows) })),
    network: networkCompare(phases, requests),
    quality: dataQuality(kept, removed, allProbes.length - probes.length),
  };
}

const fmtMs = (v) => {
  if (v === null || v === undefined) return "—";
  if (v === Number.POSITIVE_INFINITY) return `> ${OPEN_SESSION_CAP_MS / 1000} s`;
  return `${Math.round(v)} ms`;
};
const fmtPct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtCounts = (obj) => {
  const entries = Object.entries(obj);
  return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join("、") : "无";
};

export function renderReport(report, { days }) {
  const out = [];
  out.push(`# iOS 打开体验报告（最近 ${days} 天）`, "");

  out.push("## M1 卡死率（回前台后没能自己好）", "");
  out.push("| 构建 · 设备 | 回前台 | 重载 | 一直卡 | 自愈 | 卡死率 |", "| --- | --- | --- | --- | --- | --- |");
  for (const g of report.groups) {
    out.push(`| ${g.key} | ${g.m1.resumes} | ${g.m1.reload} | ${g.m1.held} | ${g.m1.recovered} | ${fmtPct(g.m1.rate)} |`);
  }
  out.push("");

  out.push("## M2 打开到能点", "");
  out.push("| 构建 · 设备 | 回前台 n | p50 | p90 | 冷启 n | p50 | p90 |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const g of report.groups) {
    out.push(
      `| ${g.key} | ${g.m2.resume.n} | ${fmtMs(g.m2.resume.p50)} | ${fmtMs(g.m2.resume.p90)} |` +
        ` ${g.m2.cold.n} | ${fmtMs(g.m2.cold.p50)} | ${fmtMs(g.m2.cold.p90)} |`,
    );
  }
  out.push("");

  out.push("## M3 新数据到达", "");
  out.push("| 构建 · 设备 | n | p50 | p90 | 建连 p50 | 首字节 p50 | 传输 p50 | 复用连接 | 没等到就切走 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const g of report.groups) {
    out.push(
      `| ${g.key} | ${g.m3.n} | ${fmtMs(g.m3.p50)} | ${fmtMs(g.m3.p90)} |` +
        ` ${fmtMs(g.m3.connectMs.p50)} | ${fmtMs(g.m3.ttfbMs.p50)} | ${fmtMs(g.m3.xferMs.p50)} |` +
        ` ${g.m3.reused} | ${g.m3.hiddenEnded} |`,
    );
  }
  out.push("");

  out.push("## M4 本地库", "");
  out.push("| 构建 · 设备 | 出错率 | 错误名 | 打开耗时 p90 |", "| --- | --- | --- | --- |");
  for (const g of report.groups) {
    out.push(`| ${g.key} | ${fmtPct(g.m4.rate)} | ${fmtCounts(g.m4.byName)} | ${fmtMs(g.m4.storageMs.p90)} |`);
  }
  out.push("");

  out.push("## 卡死诊断（甲 / 乙 / 丙）", "");
  out.push("| 构建 · 设备 | 可判定 | 分类 | 同时本地库出事 | 旧记录 | 提示 |", "| --- | --- | --- | --- | --- | --- |");
  for (const d of report.diagnosis) {
    const hints = [];
    if (d.undecidedMajority) hints.push("未定过半：甲乙都没被证实，回去看 design §2.8 的证伪条件");
    if (d.unpairedMajority) hints.push("未配对过半：早期钩子没生效，诊断字段整体不可信");
    out.push(
      `| ${d.key} | ${d.withDiag} | ${fmtCounts(d.classes)} | ${fmtCounts(d.storageByClass)} | ${d.legacy} |` +
        ` ${hints.length ? hints.join("；") : "—"} |`,
    );
  }
  out.push("");

  out.push("## 同步耗时：端上 vs 服务端", "");
  out.push("| 接口 | 端上 n | 端上 p50 | 端上 p90 | 服务端 n | 服务端 p50 | 服务端 p90 |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const key of Object.keys(SYNC_PATHS)) {
    const c = report.network.client[key];
    const s = report.network.server[key];
    out.push(
      `| ${key} | ${c.n} | ${fmtMs(c.p50)} | ${fmtMs(c.p90)} | ${s.n} | ${fmtMs(s.p50)} | ${fmtMs(s.p90)} |`,
    );
  }
  out.push("");

  const q = report.quality;
  out.push("## 数据质量", "");
  out.push(`- 去重后 ${q.total} 条，重复剔除 ${q.duplicates} 条，后台噪声剔除 ${q.backgroundNoise} 条`);
  out.push(`- 端上主动丢弃的待发报告累计 ${q.dropped} 条；无诊断字段的旧探针 ${q.legacy} 条`);
  out.push(`- 探针计数跨度 / 实收：${fmtCounts(q.probeSpan)} / ${fmtCounts(q.probeCount)}`);
  out.push(`- 出现过的构建：${q.builds.length ? q.builds.join("、") : "无（全部记录都没带构建号）"}`);
  out.push("");
  return out.join("\n");
}

const jsonReplacer = (_key, value) => (value === Number.POSITIVE_INFINITY ? "Infinity" : value);

export function main(argv = process.argv.slice(2), env = process.env, io = console) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.error(String(error?.message ?? error));
    return 2;
  }
  const target = env.TIMEDATA_PROD_SSH;
  const dbPath = env.TIMEDATA_PROD_DB;
  if (!target || !dbPath) {
    io.error("需要环境变量 TIMEDATA_PROD_SSH（ssh 目标）与 TIMEDATA_PROD_DB（生产库路径）");
    return 2;
  }
  const logs = runRemoteQuery(target, dbPath, logSql(args.days));
  const requests = runRemoteQuery(target, dbPath, requestSql(args.days));
  const report = buildReport({ logs, requests });
  io.log(args.json ? JSON.stringify(report, jsonReplacer, 2) : renderReport(report, { days: args.days }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
