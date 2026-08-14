// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.tsx";

/**
 * 打桩 useAppResumeRefresh 拿到 resume 回调手动调，而不是去派发真实 visibilitychange：
 * 要测的是「探针没落地就自救」这条判定，与恢复事件从哪来无关。
 */
let resume: (() => void) | null = null;
vi.mock("../hooks/useAppResumeRefresh.ts", () => ({
  useAppResumeRefresh: (onResume: () => void) => {
    resume = onResume;
  },
}));

// 补拍能否发出由调度器端口是否被记到决定，这里直接控制它，好把「补拍救回来」与
// 「补拍也没救回来」两条分支分开钉。
const kickScheduler = vi.hoisted(() => vi.fn(() => true));
vi.mock("../lib/schedulerHostGuard.ts", () => ({ kickScheduler }));

const { SchedulerWatchdog } = await import("./SchedulerWatchdog.tsx");

const TIMEOUT_MS = 5000;
const GRACE_MS = 1000;

beforeEach(() => {
  resume = null;
  kickScheduler.mockReset();
  kickScheduler.mockReturnValue(true);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SchedulerWatchdog", () => {
  it("探针落地就不自救——调度器活着时的常态", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS }),
    );

    // 包在 act 里 = 探针的 transition 被 flush 掉，等价于调度器正常运转。
    await act(async () => {
      resume?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(TIMEOUT_MS * 2);
    });

    expect(onDeadlock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("探针到点仍未落地时先补一拍，不直接重载", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    // 刻意不包 act：transition 排了队但永远不提交，正是 MessageChannel 丢消息后的形状。
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(kickScheduler).toHaveBeenCalledTimes(1);
    expect(onDeadlock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("补拍之后仍不落地才重载——最后手段", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    vi.advanceTimersByTime(GRACE_MS);

    expect(onDeadlock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  // 真闸：补拍救回来了还去重载，等于白白丢掉滚动位置与未提交输入。
  it("补拍把调度器救活就不重载", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(kickScheduler).toHaveBeenCalledTimes(1);

    // 补拍奏效 = 积压被冲干净、探针这时才落地。用 act 把挂起的 transition 放行来模拟。
    await act(async () => {});
    vi.advanceTimersByTime(GRACE_MS);

    expect(onDeadlock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("补拍发不出去（没记到调度器端口）就直接走最后手段", async () => {
    kickScheduler.mockReturnValue(false);
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(onDeadlock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("窗口没走完不自救——不拿误判换恢复速度", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS - 1);

    expect(onDeadlock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("一次恢复触发多条事件只自救一次", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    // visibilitychange / focus / appStateChange 在同一拍里连着来。
    resume?.();
    resume?.();
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS * 3);

    expect(kickScheduler).toHaveBeenCalledTimes(1);
    expect(onDeadlock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("卸载后不再自救——待定的定时器要跟着走", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    await unmount(root);
    vi.advanceTimersByTime(TIMEOUT_MS * 2 + GRACE_MS);

    expect(onDeadlock).not.toHaveBeenCalled();
  });
});
