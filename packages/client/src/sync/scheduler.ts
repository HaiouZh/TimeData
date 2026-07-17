// 模块级同步调度器：所有写 syncLog 的路径经 notifyWrite() 统一安排上传。
// 不依赖 React——SyncProvider 挂载时经 setExecutor 注册执行体、卸载/关云同步时注销。
// 语义：短防抖 + max-wait 硬上限；运行中被拦截的触发在本轮结束后补跑；
// executor 在位期间失败走有上限退避，60s 兜底检查 unsynced/retry-needed；
// 无 executor（bootstrap 期）只记脏标记，注册时兑现。

export const SYNC_SCHEDULE_DEBOUNCE_MS = 300;
export const SYNC_SCHEDULE_MAX_WAIT_MS = 2_000;
export const SYNC_FALLBACK_INTERVAL_MS = 60_000;
export const SYNC_RETRY_BASE_MS = 1_000;
export const SYNC_RETRY_MAX_MS = 60_000;

export type SyncRequestReason = "write" | "bump" | "resume" | "reconnect" | "fallback" | "flush" | "startup";

export interface SyncExecutorMeta {
  reason: SyncRequestReason;
  waitMs: number;
}

export interface SyncExecutorResult {
  ok: boolean;
  retryAfterMs?: number;
}

export type SyncExecutorOutcome = boolean | SyncExecutorResult;
export type SyncExecutor = (meta: SyncExecutorMeta) => Promise<SyncExecutorOutcome>;

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

export function syncExecutorSucceeded(outcome: SyncExecutorOutcome): boolean {
  return typeof outcome === "boolean" ? outcome : outcome.ok;
}

function normalizeRetryAfterMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function nextSyncRetryDelayMs(attempt: number, retryAfterMs?: number): number {
  const exponential = Math.min(SYNC_RETRY_BASE_MS * 2 ** Math.max(0, attempt), SYNC_RETRY_MAX_MS);
  return Math.max(exponential, normalizeRetryAfterMs(retryAfterMs) ?? 0);
}

export function createSyncScheduler(deps: SyncSchedulerDeps = {}): SyncScheduler {
  const now = deps.now ?? (() => Date.now());
  const getUnsyncedCount = deps.getUnsyncedCount ?? defaultGetUnsyncedCount;

  let executor: SyncExecutor | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let runningGeneration: number | null = null;
  let rerunGeneration: number | null = null;
  let pendingSince: number | null = null;
  let pendingReason: SyncRequestReason | null = null;
  let retryNeeded = false;
  let retryAttempt = 0;
  let retrySince: number | null = null;
  let retryNotBefore: number | null = null;
  let retryReason: SyncRequestReason = "write";
  let retryFlushAttempted = false;
  let executorGeneration = 0;
  let flushCheckGeneration: number | null = null;

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

  function clearRetryTimer(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function resetRetryState(): void {
    clearRetryTimer();
    retryNeeded = false;
    retryAttempt = 0;
    retrySince = null;
    retryNotBefore = null;
    retryFlushAttempted = false;
  }

  function schedule(reason: SyncRequestReason): void {
    if (pendingSince === null) pendingSince = now();
    pendingReason ??= reason;
    if (!executor) return; // bootstrap/关闭期：只留脏标记，setExecutor 时兑现
    // resume=用户回到前台，破例穿过退避窗口；其余触发不提前打失败中的服务器
    if (reason !== "resume" && retryNeeded && retryNotBefore !== null && now() < retryNotBefore) return;
    clearRetryTimer();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fire, SYNC_SCHEDULE_DEBOUNCE_MS);
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(fire, SYNC_SCHEDULE_MAX_WAIT_MS);
    }
  }

  function armRetry(retryAfterMs?: number): void {
    clearRetryTimer();
    if (!executor || !retryNeeded) return;
    const delayMs = nextSyncRetryDelayMs(retryAttempt, retryAfterMs);
    retryAttempt += 1;
    retryNotBefore = now() + delayMs;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!executor || !retryNeeded) return;
      retryNotBefore = null;
      if (pendingSince === null) pendingSince = retrySince ?? now();
      pendingReason ??= retryReason;
      fire();
    }, delayMs);
  }

  function fire(): void {
    clearPendingTimers();
    if (!executor) return;
    const runGeneration = executorGeneration;
    if (runningGeneration === runGeneration) {
      // 运行中被拦截：保留 pendingSince/pendingReason，结束后补跑时 waitMs 如实
      rerunGeneration = runGeneration;
      return;
    }
    runningGeneration = runGeneration;
    const meta: SyncExecutorMeta = {
      reason: pendingReason ?? "write",
      waitMs: pendingSince === null ? 0 : Math.max(0, now() - pendingSince),
    };
    const runExecutor = executor;
    pendingSince = null;
    pendingReason = null;
    void runExecutor(meta)
      .catch((): SyncExecutorOutcome => false)
      .then((outcome) => {
        const stillCurrent = executor === runExecutor && executorGeneration === runGeneration;
        if (runningGeneration === runGeneration) runningGeneration = null;
        if (stillCurrent) {
          if (syncExecutorSucceeded(outcome)) {
            resetRetryState();
          } else {
            const result = typeof outcome === "boolean" ? null : outcome;
            retryNeeded = true;
            retrySince ??= now();
            retryReason = meta.reason;
            retryFlushAttempted = meta.reason === "flush";
            armRetry(result?.retryAfterMs);
          }
        }
        if (stillCurrent && rerunGeneration === runGeneration) {
          rerunGeneration = null;
          const reason = pendingReason ?? "write";
          if (reason === "flush") {
            forceFlush();
          } else {
            schedule(reason);
          }
        }
      });
  }

  function kickIfUnsynced(reason: SyncRequestReason): void {
    if (retryNeeded && executor) {
      schedule(reason);
      return;
    }
    const generation = executorGeneration;
    const expectedExecutor = executor;
    void getUnsyncedCount()
      .then((count) => {
        if (
          executorGeneration === generation
          && executor === expectedExecutor
          && (count > 0 || retryNeeded)
          && executor
        ) {
          schedule(reason);
        }
      })
      .catch(() => undefined);
  }

  function forceFlush(): void {
    if (pendingSince === null) pendingSince = retrySince ?? now();
    pendingReason = "flush";
    if (retryNeeded && retryNotBefore !== null && now() < retryNotBefore) {
      if (retryFlushAttempted) return;
      retryFlushAttempted = true;
    }
    clearRetryTimer();
    retryNotBefore = null;
    if (runningGeneration === executorGeneration) {
      rerunGeneration = executorGeneration;
      return;
    }
    fire();
  }

  return {
    notifyWrite() {
      schedule("write");
    },
    requestSync(reason) {
      schedule(reason);
    },
    flushNow() {
      if (!executor) return;
      if (pendingSince !== null || debounceTimer || maxWaitTimer || retryNeeded) {
        forceFlush();
        return;
      }
      const generation = executorGeneration;
      if (flushCheckGeneration === generation) return;
      flushCheckGeneration = generation;
      void getUnsyncedCount()
        .then((count) => {
          if (count > 0 && executor && executorGeneration === generation) forceFlush();
        })
        .catch(() => undefined)
        .finally(() => {
          if (flushCheckGeneration === generation) flushCheckGeneration = null;
        });
    },
    setExecutor(next) {
      executorGeneration += 1;
      flushCheckGeneration = null;
      runningGeneration = null;
      rerunGeneration = null;
      executor = next;
      if (!next) {
        clearPendingTimers();
        resetRetryState();
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
      executorGeneration += 1;
      flushCheckGeneration = null;
      executor = null;
      clearPendingTimers();
      resetRetryState();
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      runningGeneration = null;
      rerunGeneration = null;
      pendingSince = null;
      pendingReason = null;
    },
  };
}

export const syncScheduler: SyncScheduler = createSyncScheduler();
