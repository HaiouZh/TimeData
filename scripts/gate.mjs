import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 60_000;

const LOCK_DIR_NAME = "timedata-gate.lock";
const META_NAME = "meta.json";

/** 锁钉在 git common dir 下：worktree 里 `git rev-parse --git-common-dir` 返回主仓 .git，所有 worktree 天然共享同一把。 */
export function resolveLockDir(gitCommonDir) {
  return path.join(gitCommonDir, LOCK_DIR_NAME);
}

function writeMeta(lockDir, meta) {
  // 同目录 rename 原子：避免抢锁方读到写了一半的 meta。
  const tmp = path.join(lockDir, `${META_NAME}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(meta));
  fs.renameSync(tmp, path.join(lockDir, META_NAME));
}

export function readLockInfo(lockDir) {
  let dirMtimeMs;
  try {
    dirMtimeMs = fs.statSync(lockDir).mtimeMs;
  } catch {
    return null;
  }
  try {
    return { ...JSON.parse(fs.readFileSync(path.join(lockDir, META_NAME), "utf8")), dirMtimeMs };
  } catch {
    // meta 缺失/损坏（刚 mkdir 还没写完，或写到一半被杀）：只带目录时间，交给 isStale 兜底判。
    return { dirMtimeMs };
  }
}

/**
 * 判死只看心跳，不做 pid 探测：Windows pid 回收快，pid 被复用会让 `process.kill(pid, 0)`
 * 误判「有人在跑」→ 永久阻塞；而且它对存在但无权限的进程抛 EPERM，也不止 ESRCH。
 * 心跳还顺带覆盖「进程活着但卡死」。pid 只用来打印给人看。
 */
export function isStale(info, { now, timeoutMs = HEARTBEAT_TIMEOUT_MS }) {
  const last = info?.heartbeatAt ?? info?.dirMtimeMs;
  if (typeof last !== "number") return false;
  return now - last > timeoutMs;
}

export function acquireLock({
  lockDir,
  now = () => Date.now(),
  pid = process.pid,
  worktree = process.cwd(),
  timeoutMs = HEARTBEAT_TIMEOUT_MS,
}) {
  try {
    fs.mkdirSync(lockDir);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const info = readLockInfo(lockDir);
    if (!isStale(info, { now: now(), timeoutMs })) return { ok: false, info };
    fs.rmSync(lockDir, { recursive: true, force: true });
    try {
      fs.mkdirSync(lockDir);
    } catch {
      // 接管竞态：另一份同时判死并抢先接管了。mkdir 原子，让它跑，我们继续等。
      return { ok: false, info: readLockInfo(lockDir) };
    }
  }
  const at = now();
  const meta = { pid, worktree, startedAt: at, heartbeatAt: at };
  writeMeta(lockDir, meta);
  return { ok: true, handle: { lockDir, meta } };
}

export function beatLock(handle, { now = () => Date.now() } = {}) {
  handle.meta.heartbeatAt = now();
  writeMeta(handle.lockDir, handle.meta);
}

export function releaseLock(handle) {
  fs.rmSync(handle.lockDir, { recursive: true, force: true });
}

/**
 * 全量门禁清单 = CI（.github/workflows/ci.yml）跑的同一集棘轮，顺序按「静态闸→类型→测试→文档→构建」，
 * 快的先跑、失败早停。这份清单被 scripts/package-scripts.test.mjs 守着必须覆盖 CI，别手工漂。
 */
export const GATE_STEPS = [
  { name: "lint", command: "pnpm", args: ["lint"] },
  { name: "check:ui", command: "pnpm", args: ["check:ui"] },
  { name: "check:design", command: "pnpm", args: ["check:design"] },
  { name: "check:test", command: "pnpm", args: ["check:test"] },
  { name: "check:diary", command: "pnpm", args: ["check:diary"] },
  { name: "check:settings", command: "pnpm", args: ["check:settings"] },
  { name: "typecheck", command: "pnpm", args: ["typecheck"] },
  { name: "test", command: "pnpm", args: ["test"] },
  { name: "test:e2e", command: "pnpm", args: ["--filter", "@timedata/client", "test:e2e"] },
  { name: "check:docs:strict", command: "pnpm", args: ["check:docs:strict", "--since=main"] },
  { name: "check:docs:size", command: "pnpm", args: ["check:docs:size"] },
  { name: "check:docs:coverage", command: "pnpm", args: ["check:docs:coverage", "--since=main"] },
  { name: "check:docs:links", command: "pnpm", args: ["check:docs:links"] },
  { name: "check:roadmap", command: "pnpm", args: ["check:roadmap"] },
  { name: "build", command: "pnpm", args: ["build"] },
];

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 30 * 60_000;

export function parseArgs(argv) {
  const wait = !argv.includes("--no-wait");
  return { wait, pollMs: DEFAULT_POLL_MS, maxWaitMs: DEFAULT_MAX_WAIT_MS };
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)} 分 ${total % 60} 秒`;
}

export function formatBusyMessage(info, { now }) {
  const where = info?.worktree ? path.basename(info.worktree) : "未知 worktree";
  const held = typeof info?.startedAt === "number" ? formatDuration(now - info.startedAt) : "未知时长";
  return `另一份全量门禁正在跑：${where}（pid ${info?.pid ?? "?"}，已跑 ${held}）。这不是你代码红了。`;
}

/** Windows 上 pnpm 是 .cmd，必须走 shell；参数全是本文件硬编码常量，无注入面。 */
function spawnStep(step) {
  return spawnSync(step.command, step.args, { stdio: "inherit", shell: true }).status ?? 1;
}

export async function run(argv, opts) {
  const {
    lockDir,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    runStep = spawnStep,
    log = console.log,
    error = console.error,
    pid,
    worktree,
  } = opts;
  const parsed = parseArgs(argv);
  // pollMs / maxWaitMs 允许被 opts 覆盖：测试要注入小上限，否则得空转 360 次轮询。
  const { wait } = parsed;
  const pollMs = opts.pollMs ?? parsed.pollMs;
  const maxWaitMs = opts.maxWaitMs ?? parsed.maxWaitMs;

  const deadline = now() + maxWaitMs;
  let acquired = acquireLock({ lockDir, now, pid, worktree });
  while (!acquired.ok) {
    if (!wait) {
      error(`✗ ${formatBusyMessage(acquired.info, { now: now() })}\n  等它跑完请去掉 --no-wait，gate 会自动排队。`);
      return 1;
    }
    if (now() >= deadline) {
      error(`✗ 排队超过 ${formatDuration(maxWaitMs)} 仍未轮到，先退出。\n  ${formatBusyMessage(acquired.info, { now: now() })}`);
      return 1;
    }
    log(`⏳ ${formatBusyMessage(acquired.info, { now: now() })} 排队中……`);
    await sleep(pollMs);
    acquired = acquireLock({ lockDir, now, pid, worktree });
  }

  const handle = acquired.handle;
  const beat = setInterval(() => beatLock(handle, { now }), HEARTBEAT_INTERVAL_MS);
  beat.unref?.();
  const startedAt = now();
  try {
    for (const [i, step] of GATE_STEPS.entries()) {
      log(`\n▶ [${i + 1}/${GATE_STEPS.length}] ${step.name}`);
      const code = await runStep(step);
      if (code !== 0) {
        error(`\n✗ 门禁停在 ${step.name}（退出码 ${code}）。修完重跑 \`pnpm gate\`。`);
        return code;
      }
    }
    log(`\n✓ 全量门禁通过（${GATE_STEPS.length} 步，耗时 ${formatDuration(now() - startedAt)}）。`);
    return 0;
  } finally {
    clearInterval(beat);
    releaseLock(handle);
  }
}


if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const gitCommonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
  const code = await run(process.argv.slice(2), { lockDir: resolveLockDir(path.resolve(gitCommonDir)) });
  process.exit(code);
}
