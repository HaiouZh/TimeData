import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HEARTBEAT_TIMEOUT_MS,
  acquireLock,
  beatLock,
  isStale,
  readLockInfo,
  releaseLock,
  resolveLockDir,
} from "./gate.mjs";

import { GATE_STEPS, formatBusyMessage, parseArgs, run } from "./gate.mjs";

const silent = { log: () => {}, error: () => {} };

/** 造一个临时锁父目录，绝不碰真实 .git。返回 lockDir 路径（尚未创建）。 */
function makeLockDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-gate-"));
  return { root, lockDir: path.join(root, "timedata-gate.lock") };
}

test("resolveLockDir 把锁钉在 git common dir 下（所有 worktree 共享同一把）", () => {
  assert.equal(resolveLockDir("D:/x/TimeData/.git"), path.join("D:/x/TimeData/.git", "timedata-gate.lock"));
});

test("acquireLock 首次抢到，第二次在同一把锁上抢不到并带回持有者信息", () => {
  const { root, lockDir } = makeLockDir();
  const first = acquireLock({ lockDir, now: () => 1000, pid: 111, worktree: "slot-1" });
  assert.equal(first.ok, true);

  const second = acquireLock({ lockDir, now: () => 2000, pid: 222, worktree: "slot-2" });
  assert.equal(second.ok, false);
  assert.equal(second.info.pid, 111);
  assert.equal(second.info.worktree, "slot-1");
  assert.equal(second.info.startedAt, 1000);

  fs.rmSync(root, { recursive: true, force: true });
});

test("releaseLock 删干净，锁可被重新抢到", () => {
  const { root, lockDir } = makeLockDir();
  const first = acquireLock({ lockDir, now: () => 1000 });
  releaseLock(first.handle);
  assert.equal(fs.existsSync(lockDir), false);
  assert.equal(acquireLock({ lockDir, now: () => 2000 }).ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("isStale 只看心跳，不看 pid——pid 被复用也不会误判成活着", () => {
  const now = 1_000_000;
  // 心跳刚刷过：活着（哪怕 pid 是个早就不存在的号）
  assert.equal(isStale({ pid: 999999, heartbeatAt: now - 10_000 }, { now }), false);
  // 心跳停超阈值：判死（哪怕 pid 恰好被别的进程复用、探测得到"活着"）
  assert.equal(isStale({ pid: process.pid, heartbeatAt: now - HEARTBEAT_TIMEOUT_MS - 1 }, { now }), true);
});

test("isStale 在 meta 读不出来时退回锁目录时间；两者都没有则保守当活着", () => {
  const now = 1_000_000;
  assert.equal(isStale({ dirMtimeMs: now - HEARTBEAT_TIMEOUT_MS - 1 }, { now }), true);
  assert.equal(isStale({ dirMtimeMs: now - 1_000 }, { now }), false);
  assert.equal(isStale({}, { now }), false);
  assert.equal(isStale(null, { now }), false);
});

test("beatLock 刷新心跳，让原本快判死的锁重新算活着", () => {
  const { root, lockDir } = makeLockDir();
  const { handle } = acquireLock({ lockDir, now: () => 1000 });
  const staleAt = 1000 + HEARTBEAT_TIMEOUT_MS + 1;
  assert.equal(isStale(readLockInfo(lockDir), { now: staleAt }), true);

  beatLock(handle, { now: () => staleAt });
  assert.equal(isStale(readLockInfo(lockDir), { now: staleAt }), false);
  assert.equal(readLockInfo(lockDir).startedAt, 1000, "心跳不改起始时间，耗时显示才准");

  fs.rmSync(root, { recursive: true, force: true });
});

test("残锁自愈：心跳停超阈值的锁被直接接管（taskkill //F 不跑 finally，这是常态路径）", () => {
  const { root, lockDir } = makeLockDir();
  acquireLock({ lockDir, now: () => 1000, pid: 111 });

  const takeover = acquireLock({ lockDir, now: () => 1000 + HEARTBEAT_TIMEOUT_MS + 1, pid: 222 });
  assert.equal(takeover.ok, true);
  assert.equal(readLockInfo(lockDir).pid, 222);

  fs.rmSync(root, { recursive: true, force: true });
});

test("meta.json 损坏（写到一半被杀）也能被接管，不永久堵死", () => {
  const { root, lockDir } = makeLockDir();
  acquireLock({ lockDir, now: () => 1000 });
  fs.writeFileSync(path.join(lockDir, "meta.json"), "{ 半 行 坏 json");
  // 目录时间兜底：把目录 mtime 拨老，模拟一把陈年残锁
  const old = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS * 10);
  fs.utimesSync(lockDir, old, old);

  const takeover = acquireLock({ lockDir, now: () => Date.now(), pid: 333 });
  assert.equal(takeover.ok, true);
  assert.equal(readLockInfo(lockDir).pid, 333);

  fs.rmSync(root, { recursive: true, force: true });
});

test("parseArgs 默认排队等待，--no-wait 才立即失败", () => {
  assert.equal(parseArgs([]).wait, true);
  assert.equal(parseArgs(["--no-wait"]).wait, false);
  assert.equal(parseArgs([]).maxWaitMs, 30 * 60_000);
});

test("GATE_STEPS 顺序：静态闸在前、慢活在后，失败早停才省时间", () => {
  const names = GATE_STEPS.map((s) => s.name);
  assert.ok(names.indexOf("lint") < names.indexOf("test"));
  assert.ok(names.indexOf("check:ui") < names.indexOf("build"));
  assert.equal(names.at(-1), "build");
});

test("空闲时按清单顺序全部跑完，返回 0，且跑完把锁删干净", async () => {
  const { root, lockDir } = makeLockDir();
  const ran = [];
  const code = await run([], { lockDir, runStep: (s) => (ran.push(s.name), 0), ...silent });

  assert.equal(code, 0);
  assert.deepEqual(ran, GATE_STEPS.map((s) => s.name));
  assert.equal(fs.existsSync(lockDir), false, "跑完必须释放锁");
  fs.rmSync(root, { recursive: true, force: true });
});

test("某步失败即刻停下，后续步骤不跑，退出码非 0，锁照样释放", async () => {
  const { root, lockDir } = makeLockDir();
  const ran = [];
  const code = await run([], {
    lockDir,
    runStep: (s) => {
      ran.push(s.name);
      return s.name === "lint" ? 1 : 0;
    },
    ...silent,
  });

  assert.equal(code, 1);
  assert.deepEqual(ran, ["lint"], "lint 红了就不该再往下跑");
  assert.equal(fs.existsSync(lockDir), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("步骤抛异常也释放锁，不给下一份留残锁", async () => {
  const { root, lockDir } = makeLockDir();
  await assert.rejects(
    run([], {
      lockDir,
      runStep: () => {
        throw new Error("boom");
      },
      ...silent,
    }),
  );
  assert.equal(fs.existsSync(lockDir), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("--no-wait 撞上别人持锁：一步都不跑，直接退 1", async () => {
  const { root, lockDir } = makeLockDir();
  acquireLock({ lockDir, now: () => Date.now(), pid: 111, worktree: "slot-1" });

  const ran = [];
  const code = await run(["--no-wait"], { lockDir, runStep: (s) => (ran.push(s.name), 0), ...silent });

  assert.equal(code, 1);
  assert.deepEqual(ran, []);
  assert.equal(readLockInfo(lockDir).pid, 111, "别人的锁不能被动");
  fs.rmSync(root, { recursive: true, force: true });
});

test("默认排队：等到前一份释放后自动开跑（注入 sleep，不真等）", async () => {
  const { root, lockDir } = makeLockDir();
  const holder = acquireLock({ lockDir, now: () => Date.now(), pid: 111 });

  let slept = 0;
  const sleep = async () => {
    slept += 1;
    if (slept === 2) releaseLock(holder.handle); // 第二次轮询时前一份跑完了
  };
  const ran = [];
  const code = await run([], { lockDir, sleep, runStep: (s) => (ran.push(s.name), 0), ...silent });

  assert.equal(code, 0);
  assert.equal(slept, 2);
  assert.deepEqual(ran, GATE_STEPS.map((s) => s.name));
  fs.rmSync(root, { recursive: true, force: true });
});

test("排队超时：等满上限仍拿不到就退 1，不无限挂着", async () => {
  const { root, lockDir } = makeLockDir();
  acquireLock({ lockDir, now: () => Date.now(), pid: 111 });

  let clock = 0;
  const code = await run([], {
    lockDir,
    now: () => clock,
    maxWaitMs: 20_000, // 注入小上限：真等 30 分钟当然不行，轮询 360 次也没必要
    sleep: async () => {
      clock += 5_000;
    },
    runStep: () => 0,
    ...silent,
  });

  assert.equal(code, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("排队提示写清是谁在跑、跑了多久——别让人以为是自己代码红了", () => {
  const msg = formatBusyMessage({ pid: 111, worktree: "D:/x/.worktrees/slot-1", startedAt: 0 }, { now: 125_000 });
  assert.match(msg, /slot-1/);
  assert.match(msg, /111/);
  assert.match(msg, /2 分 5 秒/);
});
