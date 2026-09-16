// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../lib/storageKeys.ts";
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
// 「补拍也没救回来」两条分支分开钉。送达判定的两个纯函数用真实实现。
const kickScheduler = vi.hoisted(() => vi.fn(() => true));
const hasSchedulerPort = vi.hoisted(() => vi.fn(() => true));
const schedulerDeliveryState = vi.hoisted(() =>
  vi.fn(() => ({ paired: true, lastPostedAt: 0 as number | null, lastDeliveredAt: null as number | null })),
);
const driveSchedulerDirectly = vi.hoisted(() => vi.fn(() => true));
vi.mock("../lib/schedulerHostGuard.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/schedulerHostGuard.ts")>();
  return { ...actual, kickScheduler, hasSchedulerPort, schedulerDeliveryState, driveSchedulerDirectly };
});

const stashPendingReport = vi.hoisted(() => vi.fn());
vi.mock("../lib/recovery/pendingReports.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recovery/pendingReports.ts")>();
  return { ...actual, stashPendingReport };
});

const markReload = vi.hoisted(() => vi.fn());
vi.mock("../lib/recovery/reloadAttribution.ts", () => ({ markReload }));

// 存储探针默认「立刻回来、耗时 12ms」；要测「没回来」的用例自己换成永不 resolve 的 Promise。
const timeStorageProbe = vi.hoisted(() =>
  vi.fn<() => Promise<{ ms: number; errorName: string | null }>>(() => Promise.resolve({ ms: 12, errorName: null })),
);
vi.mock("../lib/recovery/storageTiming.ts", () => ({ timeStorageProbe }));
const isStorageOpen = vi.hoisted(() => vi.fn<() => boolean | null>(() => true));
vi.mock("../lib/recovery/storageProbe.ts", () => ({ probeStorage: vi.fn(), isStorageOpen }));

const snapshotReactRoot = vi.hoisted(() => vi.fn<() => unknown>(() => null));
vi.mock("../lib/recovery/reactRootProbe.ts", () => ({ snapshotReactRoot }));
const snapshotInFlightLazy = vi.hoisted(() => vi.fn<() => [string, number][]>(() => []));
vi.mock("../lib/recovery/lazyRegistry.ts", () => ({ snapshotInFlightLazy }));

vi.mock("../lib/frontendUpdate.ts", () => ({ CURRENT_BUILD_ID: "test-build" }));
vi.mock("../lib/recovery/reportId.ts", () => ({ newReportId: () => "rid0000001" }));

const { SchedulerWatchdog, SCHEDULER_DIRECT_DRIVE_AFTER_MS, SCHEDULER_KICK_GRACE_MS } = await import(
  "./SchedulerWatchdog.tsx"
);

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
  timeStorageProbe.mockReset();
  timeStorageProbe.mockImplementation(() => Promise.resolve({ ms: 12, errorName: null }));
  schedulerDeliveryState.mockReset();
  schedulerDeliveryState.mockImplementation(() => ({ paired: true, lastPostedAt: 0, lastDeliveredAt: null }));
  driveSchedulerDirectly.mockReset();
  driveSchedulerDirectly.mockReturnValue(true);
  snapshotReactRoot.mockReset();
  snapshotReactRoot.mockReturnValue(null);
  snapshotInFlightLazy.mockReset();
  snapshotInFlightLazy.mockReturnValue([]);
  isStorageOpen.mockReset();
  isStorageOpen.mockReturnValue(true);
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
    localStorage.setItem(STORAGE_KEYS.schedulerProbes, "41");
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
    expect(detail.storageMs).toBe(12);
    expect(typeof detail.sinceBootMs).toBe("number");
    expect(detail.waitedMs).toBeGreaterThanOrEqual(TIMEOUT_MS);
    await unmount(root);
  });

  it("IndexedDB 探针到判定时还没回来 → storageMs 为 null", async () => {
    timeStorageProbe.mockImplementation(() => new Promise(() => {}));
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

  // 终审复核 CONFIRMED：visible 在超时那刻采样、宽限结束才拿来用，中间切到后台就会在后台重载。
  it("宽限期内切到后台 → 按宽限结束那一刻判定，记 held 不重载", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(kickScheduler).toHaveBeenCalledTimes(1);
    setVisibility("hidden"); // 补完拍、宽限还没走完，用户切走了
    vi.advanceTimersByTime(GRACE_MS);

    expect(onDeadlock).not.toHaveBeenCalled();
    expect(markReload).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ outcome: "held", visible: "hidden" });
    await unmount(root);
  });

  // 真闸三合一：重置定时器 → 补拍推迟到 T7；清掉宽限 → T6 不重载；刷新 armedAt → waitedMs 变 3000。
  it("探针挂着期间再来恢复事件不重置定时器——补拍与宽限按首发计时，waitedMs 从首发算", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(2000);
    resume?.(); // 挂着期间第二条恢复事件
    vi.advanceTimersByTime(TIMEOUT_MS - 2000);
    expect(kickScheduler).toHaveBeenCalledTimes(1);
    resume?.(); // 宽限期内第三条
    vi.advanceTimersByTime(GRACE_MS);

    expect(onDeadlock).toHaveBeenCalledTimes(1);
    const detail = lastProbeDetail();
    expect(detail.waitedMs).toBe(TIMEOUT_MS);
    expect(detail.resumes).toBe(3);
    await unmount(root);
  });

  // 终审复核 CONFIRMED：抛错与「还没回来」都留 null，阶段 2 分不出存储报错与存储被冻。
  it("IndexedDB 探针抛错 → storageMs 记 -1，与「还没回来」的 null 区分开", async () => {
    timeStorageProbe.mockImplementation(() => Promise.resolve({ ms: 40, errorName: "DatabaseClosedError" }));
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    expect(lastProbeDetail().storageMs).toBe(-1);
    expect(lastProbeDetail().storageErr).toBe("DatabaseClosedError");
    await unmount(root);
  });

  it("系统时钟回拨 → waitedMs 夹到 0，不把负数写进埋点", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.setSystemTime(Date.now() - 8000);
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    expect(lastProbeDetail().waitedMs).toBe(0);
    await unmount(root);
  });

  it("visibilityState 是 prerender 这类非 visible 值 → 按不可见处理，记 held", async () => {
    setVisibility("prerender" as DocumentVisibilityState);
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    expect(onDeadlock).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ outcome: "held", visible: "prerender" });
    await unmount(root);
  });

  it("定时器恰好迟到 2 个窗口 → 也记 late（边界含等号）", async () => {
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );

    await act(async () => {
      resume?.();
    });
    vi.setSystemTime(Date.now() + TIMEOUT_MS); // 加上定时器自己的 5 秒，正好 2 个窗口
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(lastProbeDetail()).toMatchObject({ outcome: "late" });
    expect(lastProbeDetail().waitedMs).toBe(TIMEOUT_MS * 2);
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

  it("直驱时机常量小于宽限——宽限结束前一定来得及直驱", () => {
    expect(SCHEDULER_DIRECT_DRIVE_AFTER_MS).toBeLessThan(SCHEDULER_KICK_GRACE_MS);
  });

  // 逃逸变异：去掉「已送达就不直驱」→ 送达了也直驱，报告里分不清是信道还是直驱救的。
  it("补拍后未送达且已配对 → 250ms 直驱，现场记 delivered:false / direct:ran", async () => {
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(driveSchedulerDirectly).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SCHEDULER_DIRECT_DRIVE_AFTER_MS);
    expect(driveSchedulerDirectly).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GRACE_MS - SCHEDULER_DIRECT_DRIVE_AFTER_MS);
    expect(lastProbeDetail()).toMatchObject({ paired: true, delivered: false, direct: "ran" });
    await unmount(root);
  });

  it("补拍已送达 → 不直驱，记 delivered:true / direct:none", async () => {
    schedulerDeliveryState.mockImplementation(() => ({
      paired: true,
      lastPostedAt: 0,
      lastDeliveredAt: Number.MAX_SAFE_INTEGER,
    }));
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);
    expect(driveSchedulerDirectly).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ delivered: true, direct: "none" });
    await unmount(root);
  });

  it("未配对 → 不直驱，记 paired:false / delivered:null / direct:unavailable", async () => {
    schedulerDeliveryState.mockImplementation(() => ({ paired: false, lastPostedAt: null, lastDeliveredAt: null }));
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);
    expect(driveSchedulerDirectly).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ paired: false, delivered: null, pendingMsgMs: null, direct: "unavailable" });
    await unmount(root);
  });

  // 逃逸变异：rootPre 与 rootPost 用同一次快照 → 看不出补拍前后根状态有没有变。
  it("根快照补拍前、宽限结束各采一次，全字段形状钉死", async () => {
    const pre = { p: 512, s: 512, pg: 0, cb: false, cpc: false };
    const post = { p: 1024, s: 0, pg: 0, cb: true, cpc: false };
    snapshotReactRoot.mockReturnValueOnce(pre).mockReturnValueOnce(post);
    snapshotInFlightLazy.mockReturnValue([["TodoPage", 5300]]);
    isStorageOpen.mockReturnValue(false);
    localStorage.setItem(STORAGE_KEYS.schedulerProbes, "9");
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    resume?.("appStateChange");
    await Promise.resolve();
    vi.advanceTimersByTime(TIMEOUT_MS + GRACE_MS);

    const detail = lastProbeDetail();
    expect(detail).toEqual({
      outcome: "reload",
      hadPort: true,
      kicked: true,
      recovered: false,
      visible: "visible",
      waitedMs: TIMEOUT_MS,
      probes: 10,
      maxGapMs: 0,
      sinceBootMs: expect.any(Number),
      storageMs: 12,
      resumes: 1,
      trigger: "appStateChange",
      id: "rid0000001",
      sessionId: null,
      build: "test-build",
      paired: true,
      delivered: false,
      pendingMsgMs: expect.any(Number),
      direct: "ran",
      rootPre: pre,
      rootPost: post,
      lazy: [["TodoPage", 5300]],
      storageErr: null,
      dbOpen: false,
    });
    await unmount(root);
  });

  it("直驱救活（宽限内落地）→ 记 recovered，不重载、不留墓碑", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS + SCHEDULER_DIRECT_DRIVE_AFTER_MS);
    await act(async () => {}); // 直驱之后探针落地
    vi.advanceTimersByTime(GRACE_MS);
    expect(onDeadlock).not.toHaveBeenCalled();
    expect(markReload).not.toHaveBeenCalled();
    expect(lastProbeDetail()).toMatchObject({ outcome: "recovered", direct: "ran" });
    await unmount(root);
  });

  // 逃逸变异：dispose 只清宽限定时器、不清直驱定时器 → 卸载后仍会直驱。
  it("补拍之后卸载 → 直驱与宽限两枚定时器都跟着走", async () => {
    const onDeadlock = vi.fn();
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock, timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS);
    await unmount(root);
    vi.advanceTimersByTime(GRACE_MS * 2);
    expect(driveSchedulerDirectly).not.toHaveBeenCalled();
    expect(onDeadlock).not.toHaveBeenCalled();
    expect(stashPendingReport).not.toHaveBeenCalled();
  });

  // 上面那条是假闸：schedule 的回调里还有一道 disposed 二次守卫，两枚定时器就算一枚都没清，
  // 到点也什么都不做——把 dispose 里的 clearTimeout 整个删掉它照样绿（执行器实测并如实报了）。
  // 漏清真正改变的是「定时器还挂不挂着」：一枚挂着的定时器把已卸载的整棵树连同闭包钉在内存里，
  // 还会在 iOS 该让线程睡下去的时候把它叫醒——而这正是本主题要治的那个病。这一条钉那个。
  it("卸载后一枚定时器都不许剩下——直驱、宽限、心跳三个 handle 都要被清掉", async () => {
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    resume?.();
    vi.advanceTimersByTime(TIMEOUT_MS); // 补拍已发：直驱与宽限两枚定时器 + 心跳这一枚 interval 同时挂着
    expect(vi.getTimerCount()).toBe(3);
    await unmount(root);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("late 记录也带诊断字段：未补拍、direct:none、delivered:null、rootPre:null", async () => {
    snapshotReactRoot.mockReturnValue({ p: 0, s: 0, pg: 0, cb: false, cpc: false });
    const { root } = await renderDom(
      createElement(SchedulerWatchdog, { onDeadlock: vi.fn(), timeoutMs: TIMEOUT_MS, kickGraceMs: GRACE_MS }),
    );
    await act(async () => {
      resume?.();
    });
    vi.setSystemTime(Date.now() + TIMEOUT_MS * 4);
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(lastProbeDetail()).toMatchObject({
      outcome: "late",
      delivered: null,
      direct: "none",
      rootPre: null,
      rootPost: { p: 0, s: 0, pg: 0, cb: false, cpc: false },
    });
    await unmount(root);
  });
});
