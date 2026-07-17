import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSyncScheduler,
  nextSyncRetryDelayMs,
  SYNC_FALLBACK_INTERVAL_MS,
  SYNC_RETRY_BASE_MS,
  SYNC_RETRY_MAX_MS,
  SYNC_SCHEDULE_DEBOUNCE_MS,
  SYNC_SCHEDULE_MAX_WAIT_MS,
  type SyncExecutorMeta,
} from "./scheduler.ts";

describe("createSyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("防抖合并连续写入为一次执行，waitMs 从首次写入起算", async () => {
    const calls: SyncExecutorMeta[] = [];
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(async (meta) => {
      calls.push(meta);
      return true;
    });
    await vi.advanceTimersByTimeAsync(0); // 消化 setExecutor 的 startup 检查（count=0 不 kick）
    scheduler.notifyWrite();
    await vi.advanceTimersByTimeAsync(100);
    scheduler.notifyWrite();
    await vi.advanceTimersByTimeAsync(100);
    scheduler.notifyWrite();
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].reason).toBe("write");
    expect(calls[0].waitMs).toBe(200 + SYNC_SCHEDULE_DEBOUNCE_MS);
    scheduler.dispose();
  });

  it("max-wait 硬上限：持续写入不无限顺延，2s 必发", async () => {
    const executor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.notifyWrite();
    // 每 200ms 写一次，共 12 次（2400ms），每次都刷新 300ms 防抖窗口，防抖本身永不到点。
    for (let i = 0; i < 11; i++) {
      await vi.advanceTimersByTimeAsync(200);
      scheduler.notifyWrite();
    }
    // 首次写入发生在 t=1000，max-wait=2000ms，故应在 t=3000（即首次写入后 2000ms）触发。
    // 循环已推进 11*200=2200ms，此时刻已过 max-wait 边界，executor 应恰好调用过 1 次。
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("write");
    expect(executor.mock.calls[0][0].waitMs).toBe(SYNC_SCHEDULE_MAX_WAIT_MS);

    scheduler.dispose();
  });

  it("无 executor 只记脏不设 timer，setExecutor 时兑现（reason=write, waitMs 如实）", async () => {
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.notifyWrite();
    await vi.advanceTimersByTimeAsync(5_000);

    const executor = vi.fn(async () => true);
    scheduler.setExecutor(executor);
    expect(executor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("write");
    expect(executor.mock.calls[0][0].waitMs).toBeGreaterThanOrEqual(5_000);

    scheduler.dispose();
  });

  it("setExecutor 时 unsynced>0 触发 startup kick", async () => {
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 3 });
    const executor = vi.fn(async () => true);
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0); // 消化 getUnsyncedCount 的 promise resolve
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("startup");

    scheduler.dispose();
  });

  it("setExecutor 时 unsynced==0 且无脏标记则不跑", async () => {
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    const executor = vi.fn(async () => true);
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_MAX_WAIT_MS + SYNC_FALLBACK_INTERVAL_MS);

    expect(executor).not.toHaveBeenCalled();

    scheduler.dispose();
  });

  it("运行中到点的触发不丢弃，本轮结束后自动补跑", async () => {
    let resolveRun: ((v: boolean) => void) | null = null;
    const gate = new Promise<boolean>((resolve) => {
      resolveRun = resolve;
    });
    const calls: SyncExecutorMeta[] = [];
    let callCount = 0;
    const executor = vi.fn(async (meta: SyncExecutorMeta) => {
      callCount += 1;
      calls.push(meta);
      if (callCount === 1) return gate;
      return true;
    });

    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.notifyWrite();
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(1); // 首轮已开始运行，挂在 gate 上

    // 运行中再次写入，防抖窗到点时应撞上 running，不能立刻触发第二轮
    scheduler.notifyWrite();
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(1);

    // resolve 首轮后应自动补跑第二轮
    resolveRun?.(true);
    await vi.advanceTimersByTimeAsync(0); // 让首轮 promise 链 (.then) 结算
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);

    expect(executor).toHaveBeenCalledTimes(2);
    expect(calls[1].reason).toBe("write");

    scheduler.dispose();
  });

  it("执行失败后按上限指数退避，成功后复位", async () => {
    const executor = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.notifyWrite();
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS - 1);
    expect(executor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(executor).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS * 2);
    expect(executor).toHaveBeenCalledTimes(3);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS);
    expect(executor).toHaveBeenCalledTimes(5);

    scheduler.dispose();
  });

  it("失败结果尊重 retryAfterMs，且 pull-only（unsynced=0）也会重试", async () => {
    const executor = vi.fn().mockResolvedValueOnce({ ok: false, retryAfterMs: 12_000 }).mockResolvedValueOnce(true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(11_999);
    expect(executor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[1][0].reason).toBe("bump");

    scheduler.dispose();
  });

  it("Retry-After 窗口内的 fallback/reconnect 不提前请求，hidden flush 可破例一次", async () => {
    const executor = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 90_000 })
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 90_000 })
      .mockResolvedValueOnce(true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(1);

    scheduler.requestSync("reconnect");
    await vi.advanceTimersByTimeAsync(SYNC_FALLBACK_INTERVAL_MS);
    expect(executor).toHaveBeenCalledTimes(1);

    scheduler.flushNow();
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[1][0].reason).toBe("flush");

    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(executor).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(executor).toHaveBeenCalledTimes(3);

    scheduler.dispose();
  });

  it("退避窗口内 resume 破例安排同步（用户打开 app 优先于退避等待）", async () => {
    const executor = vi.fn().mockResolvedValueOnce({ ok: false, retryAfterMs: 90_000 }).mockResolvedValueOnce(true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(1);

    scheduler.requestSync("resume");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[1][0].reason).toBe("resume");

    scheduler.dispose();
  });

  it("executor reject 也进入退避重试", async () => {
    const executor = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS + SYNC_RETRY_BASE_MS);

    expect(executor).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("兜底周期：unsynced>0 每 60s 推一轮；==0 不推", async () => {
    let unsyncedCount = 0;
    const executor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => unsyncedCount });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor).not.toHaveBeenCalled();

    // 第一个兜底周期：unsynced==0，不应推动
    await vi.advanceTimersByTimeAsync(SYNC_FALLBACK_INTERVAL_MS);
    expect(executor).not.toHaveBeenCalled();

    // 第二个兜底周期：unsynced>0，应推一轮 fallback
    unsyncedCount = 2;
    await vi.advanceTimersByTimeAsync(SYNC_FALLBACK_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("fallback");

    scheduler.dispose();
  });

  it("flushNow 跳过防抖立即执行；无 pending/outbox/retry 时为 no-op", async () => {
    const executor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    // 无 pending 时 flushNow 是 no-op
    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(executor).not.toHaveBeenCalled();

    // 有 pending 时 flushNow 立即执行，不等待防抖窗口，reason 标记为 flush
    scheduler.notifyWrite();
    scheduler.flushNow();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("flush");

    scheduler.dispose();
  });

  it("flushNow 会检查真实 outbox，即使没有 scheduler pending 也立即执行", async () => {
    const executor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 2 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    executor.mockClear();

    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("flush");
    scheduler.dispose();
  });

  it("连续 hidden/pagehide 只共享一次 outbox 预检并执行一轮 flush", async () => {
    let resolveFlushCheck: ((count: number) => void) | null = null;
    const flushCheck = new Promise<number>((resolve) => {
      resolveFlushCheck = resolve;
    });
    const getUnsyncedCount = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(0)
      .mockReturnValueOnce(flushCheck);
    const executor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.flushNow();
    scheduler.flushNow();
    expect(getUnsyncedCount).toHaveBeenCalledTimes(2);

    resolveFlushCheck?.(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("flush");
    scheduler.dispose();
  });

  it("flushNow 在 running 中发现新 outbox 时安排结束后补跑", async () => {
    let resolveRun: ((v: boolean) => void) | null = null;
    const gate = new Promise<boolean>((resolve) => {
      resolveRun = resolve;
    });
    let callCount = 0;
    const executor = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return gate;
      return true;
    });
    let unsyncedCount = 0;
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => unsyncedCount });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.notifyWrite();
    scheduler.flushNow();
    expect(executor).toHaveBeenCalledTimes(1);

    unsyncedCount = 1;
    scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(executor).toHaveBeenCalledTimes(1);

    resolveRun?.(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[1][0].reason).toBe("flush");
    scheduler.dispose();
  });

  it("flushNow 会兑现已到期的 retry-needed", async () => {
    const executor = vi.fn().mockResolvedValueOnce({ ok: false, retryAfterMs: 0 }).mockResolvedValueOnce(true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS);
    scheduler.flushNow();
    expect(executor).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });

  it("requestSync 透传 reason（bump/resume/reconnect）", async () => {
    const executor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].reason).toBe("bump");

    scheduler.requestSync("resume");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[1][0].reason).toBe("resume");

    scheduler.requestSync("reconnect");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(executor).toHaveBeenCalledTimes(3);
    expect(executor.mock.calls[2][0].reason).toBe("reconnect");

    scheduler.dispose();
  });

  it("setExecutor(null) 清防抖与兜底 timer；dispose 全复位", async () => {
    const executor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(executor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.notifyWrite();
    scheduler.setExecutor(null);

    // 大量推进时间：防抖、max-wait、兜底周期全部应已被清除，不应再有调用
    await vi.advanceTimersByTimeAsync(SYNC_FALLBACK_INTERVAL_MS * 3);
    expect(executor).not.toHaveBeenCalled();

    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(SYNC_FALLBACK_INTERVAL_MS * 3);
    expect(executor).not.toHaveBeenCalled();
  });

  it("旧 executor 晚结束不会清掉新 generation 的 running 状态", async () => {
    let resolveOld: ((value: boolean) => void) | null = null;
    const oldRun = new Promise<boolean>((resolve) => {
      resolveOld = resolve;
    });
    let resolveNew: ((value: boolean) => void) | null = null;
    const newRun = new Promise<boolean>((resolve) => {
      resolveNew = resolve;
    });
    const oldExecutor = vi.fn(() => oldRun);
    const newExecutor = vi.fn().mockReturnValueOnce(newRun).mockResolvedValueOnce(true);
    const scheduler = createSyncScheduler({ getUnsyncedCount: async () => 0 });
    scheduler.setExecutor(oldExecutor);
    await vi.advanceTimersByTimeAsync(0);

    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(oldExecutor).toHaveBeenCalledTimes(1);

    scheduler.setExecutor(null);
    scheduler.setExecutor(newExecutor);
    scheduler.requestSync("bump");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(newExecutor).toHaveBeenCalledTimes(1);

    resolveOld?.(false);
    await vi.advanceTimersByTimeAsync(0);
    scheduler.requestSync("write");
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(newExecutor).toHaveBeenCalledTimes(1);

    resolveNew?.(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(newExecutor).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("旧 generation 的异步 outbox 预检不会给新 executor 安排 startup", async () => {
    let resolveOldCheck: ((count: number) => void) | null = null;
    const oldCheck = new Promise<number>((resolve) => {
      resolveOldCheck = resolve;
    });
    let resolveNewCheck: ((count: number) => void) | null = null;
    const newCheck = new Promise<number>((resolve) => {
      resolveNewCheck = resolve;
    });
    const getUnsyncedCount = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(oldCheck)
      .mockReturnValueOnce(newCheck);
    const oldExecutor = vi.fn(async () => true);
    const newExecutor = vi.fn(async () => true);
    const scheduler = createSyncScheduler({ getUnsyncedCount });

    scheduler.setExecutor(oldExecutor);
    scheduler.setExecutor(null);
    scheduler.setExecutor(newExecutor);

    resolveNewCheck?.(1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(newExecutor).toHaveBeenCalledTimes(1);

    resolveOldCheck?.(1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SYNC_SCHEDULE_DEBOUNCE_MS);
    expect(newExecutor).toHaveBeenCalledTimes(1);
    expect(oldExecutor).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});

describe("nextSyncRetryDelayMs", () => {
  it("指数增长并封顶 60s，Retry-After 可延后重试", () => {
    expect(nextSyncRetryDelayMs(0)).toBe(SYNC_RETRY_BASE_MS);
    expect(nextSyncRetryDelayMs(3)).toBe(8_000);
    expect(nextSyncRetryDelayMs(20)).toBe(SYNC_RETRY_MAX_MS);
    expect(nextSyncRetryDelayMs(0, 12_000)).toBe(12_000);
  });
});
