// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.tsx";

/**
 * 打桩 useAppResumeRefresh 拿到 resume 回调手动调，而不是去派发真实 visibilitychange：
 * 要测的是「探针没落地就自救」这条判定，与恢复事件从哪来无关。
 */
let resume: ((source?: string) => void) | null = null;
vi.mock("../hooks/useAppResumeRefresh.ts", () => ({
  useAppResumeRefresh: (onResume: (source?: string) => void) => {
    resume = onResume;
  },
}));

// 补拍能否发出由调度器端口是否被记到决定，这里直接控制它，好把「补拍救回来」与
// 「补拍也没救回来」两条分支分开钉。
const kickScheduler = vi.hoisted(() => vi.fn(() => true));
const hasSchedulerPort = vi.hoisted(() => vi.fn(() => true));
vi.mock("../lib/schedulerHostGuard.ts", () => ({ kickScheduler, hasSchedulerPort }));

const stashPendingReport = vi.hoisted(() => vi.fn());
vi.mock("../lib/recovery/pendingReports.ts", () => ({ stashPendingReport }));

const markReload = vi.hoisted(() => vi.fn());
vi.mock("../lib/recovery/reloadAttribution.ts", () => ({ markReload }));

// IDB 探针默认「立刻回来」；要测「没回来」的用例自己换成永不 resolve 的 Promise。
const probeStorage = vi.hoisted(() => vi.fn<() => Promise<unknown>>(() => Promise.resolve([])));
vi.mock("../lib/recovery/storageProbe.ts", () => ({ probeStorage }));

const { SchedulerWatchdog } = await import("./SchedulerWatchdog.tsx");

const TIMEOUT_MS = 5000;
const GRACE_MS = 1000;

function lastProbeDetail(): Record<string, unknown> {
  const calls = stashPendingReport.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const report = calls[calls.length - 1][0] as { action: string; detail?: string };
  expect(report.action).toBe("scheduler_probe");
  return JSON.parse(report.detail ?? "{}") as Record<string, unknown>;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  resume = null;
  kickScheduler.mockReset();
  kickScheduler.mockReturnValue(true);
  hasSchedulerPort.mockReset();
  hasSchedulerPort.mockReturnValue(true);
  stashPendingReport.mockReset();
  markReload.mockReset();
  probeStorage.mockReset();
  probeStorage.mockImplementation(() => Promise.resolve([]));
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  setVisibility("visible");
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

  // 真闸：去掉可见性检查就红——不可见时重载等于在用户看不见的时候丢掉他的滚动位置与输入。
  it("判定时页面不可见 → 补拍照做、但不重载、不留墓碑，下次 resume 还能再救", async () => {
    setVisibility("hidden");
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(kickScheduler).toHaveBeenCalledTimes(1); // 真闸：把 kick 挪进可见分支就红
    vi.advanceTimersByTime(GRACE_MS);

    expect(onDeadlock).not.toHaveBeenCalled();
    expect(markReload).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ outcome: "held", visible: "hidden", kicked: true, recovered: false });

    // firedRef 没置位：再来一次 resume，看门狗仍会补拍
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(kickScheduler).toHaveBeenCalledTimes(2);
    await unmount(root);
  });

  // 真闸：让宽限分支直接 return（现状）就没有这条记录。
  it("补拍后落地 → 记 recovered，不重载、不留墓碑", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    await act(async () => {}); // 补拍奏效，探针此刻落地
    vi.advanceTimersByTime(GRACE_MS);

    expect(onDeadlock).not.toHaveBeenCalled();
    expect(markReload).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ outcome: "recovered", recovered: true, kicked: true, hadPort: true });
    await unmount(root);
  });

  // 真闸：恢复现状的 giveUp() 早退就红——补拍没发出去不代表调度器一定死了。
  it("补拍发不出去 → 照走宽限窗口，宽限内落地就不重载", async () => {
    kickScheduler.mockReturnValue(false);
    hasSchedulerPort.mockReturnValue(false);
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(onDeadlock).not.toHaveBeenCalled(); // 不再立即重载
    await act(async () => {});
    vi.advanceTimersByTime(GRACE_MS);

    expect(onDeadlock).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ outcome: "recovered", hadPort: false, kicked: false });
    await unmount(root);
  });

  it("补拍发不出去且宽限后仍没落地 → 才重载，现场记 hadPort:false / kicked:false", async () => {
    kickScheduler.mockReturnValue(false);
    hasSchedulerPort.mockReturnValue(false);
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    expect(onDeadlock).toHaveBeenCalledTimes(1);
    expect(markReload).toHaveBeenCalledWith("watchdog", expect.any(Number));
    expect(lastProbeDetail()).toMatchObject({
      outcome: "reload",
      hadPort: false,
      kicked: false,
      recovered: false,
      visible: "visible",
    });
    await unmount(root);
  });

  // 真闸：把 markReload 提到分支外，held / recovered 用例里 markReload 就会被调到。
  it("真重载那条路才留墓碑，且墓碑写在重载之前", async () => {
    const order: string[] = [];
    markReload.mockImplementation(() => order.push("tombstone"));
    const onDeadlock = vi.fn(() => order.push("reload"));
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    expect(order).toEqual(["tombstone", "reload"]);
    await unmount(root);
  });

  it("现场带上分母与线程 / 存储探针：probes 累计、maxGapMs、storageMs、sinceBootMs、resumes、trigger", async () => {
    localStorage.setItem("timedata_scheduler_probes", "41");
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.("focus");
    resume?.("appStateChange"); // 同一拍第二条恢复事件
    await Promise.resolve(); // 让 IDB 探针的 then 跑掉
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    const detail = lastProbeDetail();
    expect(detail.probes).toBe(42);
    expect(detail.resumes).toBe(2);
    expect(detail.trigger).toBe("appStateChange");
    expect(detail.maxGapMs).toBe(0);
    expect(typeof detail.storageMs).toBe("number");
    expect(typeof detail.sinceBootMs).toBe("number");
    expect(detail.waitedMs).toBeGreaterThanOrEqual(TIMEOUT_MS);
    await unmount(root);
  });

  it("IndexedDB 探针到判定时还没回来 → storageMs 为 null", async () => {
    probeStorage.mockImplementation(() => new Promise(() => {}));
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    expect(lastProbeDetail().storageMs).toBeNull();
    await unmount(root);
  });

  // 真闸：这是「用户等了 30 秒但看门狗没重载」那种卡唯一能被看见的地方。去掉 late 分支就红。
  it("探针落地了但定时器迟到 ≥ 2 个窗口 → 记 late，不补拍不重载", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    await act(async () => {
      resume?.(); // 包 act：探针立刻落地，调度器是活的
    });
    vi.setSystemTime(Date.now() + TIMEOUT_MS * 4); // 挂钟走了 20 秒定时器才跑——线程被冻过
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(kickScheduler).not.toHaveBeenCalled();
    expect(onDeadlock).not.toHaveBeenCalled();
    expect(markReload).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ outcome: "late", recovered: true, kicked: false });
    expect(lastProbeDetail().waitedMs).toBeGreaterThanOrEqual(TIMEOUT_MS * 4);
    await unmount(root);
  });

  it("探针准点落地就什么都不记——正常路径零上报", async () => {
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS }),
    );
    await act(async () => {
      resume?.();
    });
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(stashPendingReport).not.toHaveBeenCalled();
    await unmount(root);
  });
});
