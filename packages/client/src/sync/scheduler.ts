// 模块级同步调度器：所有写 syncLog 的路径经 notifyWrite() 统一安排上传。
// 不依赖 React——SyncProvider 挂载时经 setExecutor 注册执行体、卸载/关云同步时注销。
// 语义：短防抖 + max-wait 硬上限；运行中被拦截的触发在本轮结束后补跑；
// executor 在位期间 60s 兜底检查 unsynced；无 executor（bootstrap 期）只记脏标记，注册时兑现。

export const SYNC_SCHEDULE_DEBOUNCE_MS = 300;
export const SYNC_SCHEDULE_MAX_WAIT_MS = 2_000;
export const SYNC_FALLBACK_INTERVAL_MS = 60_000;

export type SyncRequestReason =
  | "write"
  | "bump"
  | "resume"
  | "reconnect"
  | "fallback"
  | "flush"
  | "startup";

export interface SyncExecutorMeta {
  reason: SyncRequestReason;
  waitMs: number;
}

export type SyncExecutor = (meta: SyncExecutorMeta) => Promise<boolean>;

export interface SyncSchedulerDeps {
  getUnsyncedCount?: () => Promise<number>;
  now?: () => number;
}

export interface SyncScheduler {
  notifyWrite(): void;
  requestSync(reason: SyncRequestReason): void;
  flushNow(): void;
  setExecutor(executor: SyncExecutor | null): void;
  dispose(): void;
}

async function defaultGetUnsyncedCount(): Promise<number> {
  // 动态 import 避免 scheduler ↔ db 静态循环依赖（db/index.ts 也会 import 本模块）
  const { db } = await import("../db/index.js");
  return db.syncLog.where("synced").equals(0).count();
}

export function createSyncScheduler(deps: SyncSchedulerDeps = {}): SyncScheduler {
  const now = deps.now ?? (() => Date.now());
  const getUnsyncedCount = deps.getUnsyncedCount ?? defaultGetUnsyncedCount;

  let executor: SyncExecutor | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let rerunAfterRun = false;
  let pendingSince: number | null = null;
  let pendingReason: SyncRequestReason | null = null;

  function clearPendingTimers(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  }

  function schedule(reason: SyncRequestReason): void {
    if (pendingSince === null) pendingSince = now();
    pendingReason ??= reason;
    if (!executor) return; // bootstrap/关闭期：只留脏标记，setExecutor 时兑现
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fire, SYNC_SCHEDULE_DEBOUNCE_MS);
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(fire, SYNC_SCHEDULE_MAX_WAIT_MS);
    }
  }

  function fire(): void {
    clearPendingTimers();
    if (!executor) return;
    if (running) {
      // 运行中被拦截：保留 pendingSince/pendingReason，结束后补跑时 waitMs 如实
      rerunAfterRun = true;
      return;
    }
    running = true;
    const meta: SyncExecutorMeta = {
      reason: pendingReason ?? "write",
      waitMs: pendingSince === null ? 0 : Math.max(0, now() - pendingSince),
    };
    pendingSince = null;
    pendingReason = null;
    void executor(meta)
      .catch(() => false)
      .then(() => {
        running = false;
        if (rerunAfterRun) {
          rerunAfterRun = false;
          // 失败滞留不在此重试（交 60s 兜底），只兑现运行期被拦截的触发
          schedule(pendingReason ?? "write");
        }
      });
  }

  function kickIfUnsynced(reason: SyncRequestReason): void {
    void getUnsyncedCount()
      .then((count) => {
        if (count > 0 && executor) schedule(reason);
      })
      .catch(() => undefined);
  }

  return {
    notifyWrite() {
      schedule("write");
    },
    requestSync(reason) {
      schedule(reason);
    },
    flushNow() {
      if (!executor || running) return;
      if (pendingSince === null && !debounceTimer && !maxWaitTimer) return;
      pendingReason = "flush";
      fire();
    },
    setExecutor(next) {
      executor = next;
      if (!next) {
        clearPendingTimers();
        if (fallbackTimer) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
        return;
      }
      if (!fallbackTimer) {
        fallbackTimer = setInterval(() => {
          kickIfUnsynced("fallback");
        }, SYNC_FALLBACK_INTERVAL_MS);
      }
      if (pendingSince !== null) {
        schedule(pendingReason ?? "startup");
      } else {
        kickIfUnsynced("startup");
      }
    },
    dispose() {
      executor = null;
      clearPendingTimers();
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      running = false;
      rerunAfterRun = false;
      pendingSince = null;
      pendingReason = null;
    },
  };
}

export const syncScheduler: SyncScheduler = createSyncScheduler();
