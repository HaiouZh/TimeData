import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupSessions,
  kbdSql,
  main,
  parseArgs,
  parseRows,
  renderReport,
  renderTimeline,
  summarize,
  validateSshTarget,
} from "./kbd-report.mjs";

const row = (detail, device = "iPhone", ts = "2026-09-17 10:00:00", id = 1) => ({
  id,
  timestamp: ts,
  device,
  action: "kbd_session",
  detail: JSON.stringify(detail),
});

const sample = {
  v: 1,
  p: "ios",
  os: "17.5",
  b: "b9",
  r: "/todo",
  in: "dock",
  kh: 336,
  ev: [
    ["fi", 0, 0, 0],
    ["ws", 213, 40, 0],
    ["ts", 230, 40, 0],
    ["ds", 470, 0, 0],
    ["te", 478, 0, 0],
    ["wh", 3300, 0, 0],
    ["dh", 3560, 0, 0],
  ],
  ff: [18, 34],
  dur: [257, 260],
  mo: [250, 250, "ios"],
  nav: 0,
};

test("parseRows 跳过坏 JSON 与非 v1，保留设备与时间", () => {
  const out = parseRows([row(sample), { ...row(sample), detail: "{bad" }, row({ ...sample, v: 2 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].device, "iPhone");
  assert.equal(out[0].session.kh, 336);
});

test("renderTimeline 一行含相邻事件的增量、scrollY 非零标记、ff / dur / mo / nav / kh / in", () => {
  const line = renderTimeline(parseRows([row(sample)])[0]);
  assert.match(line, /fi → ws\+213\(sy40\) → ts\+17\(sy40\) → ds\+240 → te\+8 → wh\+2822 → dh\+260/);
  assert.match(line, /ff=18\/34/);
  assert.match(line, /dur=257\/260/);
  assert.match(line, /mo=250\/250 ios/);
  assert.match(line, /nav=0/);
  assert.match(line, /kh=336/);
  assert.match(line, /in=dock/);
});

test("renderTimeline：没量到的项打 -，trunc 标出来", () => {
  const line = renderTimeline(parseRows([row({ ...sample, ff: [null, null], dur: [null, 300], trunc: true })])[0]);
  assert.match(line, /ff=-\/-/);
  assert.match(line, /dur=-\/300/);
  assert.match(line, /trunc/);
});

test("groupSessions 按 构建·设备·平台·页面 分组；summarize 出 n 与 dur/ff 的 p50 p90", () => {
  const rows = [
    row(sample, "iPhone", "2026-09-17 10:00:00", 1),
    row({ ...sample, dur: [300, 300], ff: [60, 10] }, "iPhone", "2026-09-17 10:01:00", 2),
    row({ ...sample, p: "android", b: "b9" }, "Pixel", "2026-09-17 10:02:00", 3),
  ];
  const groups = groupSessions(parseRows(rows));
  assert.deepEqual([...groups.keys()].sort(), ["b9 · Pixel · android · /todo", "b9 · iPhone · ios · /todo"]);
  const s = summarize(groups.get("b9 · iPhone · ios · /todo"));
  assert.equal(s.n, 2);
  assert.deepEqual(s.p50.dur, [257, 260]);
  assert.deepEqual(s.p90.dur, [300, 300]);
  assert.deepEqual(s.p90.ff, [60, 34]);
});

test("summarize 对全空样本给 null 而不是 NaN", () => {
  const s = summarize(parseRows([row({ ...sample, dur: [null, null], ff: [null, null] })]));
  assert.deepEqual(s.p50.dur, [null, null]);
  assert.deepEqual(s.p90.ff, [null, null]);
});

test("validateSshTarget 拒绝空串与以 - 开头的目标（会被 ssh 当选项）", () => {
  assert.throws(() => validateSshTarget("-oProxyCommand=x"), /ssh 目标/);
  assert.throws(() => validateSshTarget(""), /ssh 目标/);
  assert.equal(validateSshTarget("root@host"), "root@host");
});

test("kbdSql 只取 kbd_session、按天数过滤；parseArgs 默认 7 天、拒非整数", () => {
  assert.match(kbdSql(7), /action = 'kbd_session'/);
  assert.match(kbdSql(7), /-7 days/);
  assert.equal(parseArgs([]).days, 7);
  assert.equal(parseArgs(["--days", "3"]).days, 3);
  assert.throws(() => parseArgs(["--days", "x"]), /--days/);
});

test("renderReport 每组一段：标题行 + 汇总行 + 每条时间线", () => {
  const text = renderReport(parseRows([row(sample), row({ ...sample, p: "android" }, "Pixel")]), { days: 7 });
  assert.match(text, /b9 · iPhone · ios · \/todo/);
  assert.match(text, /b9 · Pixel · android · \/todo/);
  assert.match(text, /n=1 dur p50=257\/260 p90=257\/260 ff p50=18\/34 p90=18\/34/);
  assert.match(text, /2026-09-17 10:00:00 {2}fi → ws\+213/);
});

test("main：缺环境变量退 2 并提示；ssh 目标非法退 2", () => {
  const errors = [];
  const io = { log: () => {}, error: (m) => errors.push(m) };
  assert.equal(main([], {}, io), 2);
  assert.match(errors[0], /TIMEDATA_PROD_SSH/);
  assert.equal(main([], { TIMEDATA_PROD_SSH: "-bad", TIMEDATA_PROD_DB: "/x.db" }, io), 2);
  assert.match(errors[1], /ssh 目标/);
});
