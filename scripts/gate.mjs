import fs from "node:fs";
import path from "node:path";

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
