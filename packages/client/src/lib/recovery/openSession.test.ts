import { describe, expect, it } from "vitest";
import type { SyncTimingEntry } from "../../sync/phaseTimings.js";
import {
  OPEN_SESSION_CAP_MS,
  type OpenSessionDeps,
  buildOpenSessionReport,
  createOpenSessionTracker,
} from "./openSession.js";
import { SYNC_LOG_DETAIL_MAX, type PendingReport } from "./pendingReports.js";

interface FakeTimer {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

function harness(overrides: Partial<OpenSessionDeps> = {}) {
  let perf = 10_000;
  let wall = Date.parse("2026-09-15T10:00:00.000Z");
  let nextId = 0;
  const timers: FakeTimer[] = [];
  const stashed: PendingReport[] = [];
  const deps: OpenSessionDeps = {
    now: () => perf,
    wallNow: () => wall,
    build: "build-1",
    newId: () => `s${++nextId}`,
    stash: (report) => {
      stashed.push(report);
    },
    takeDropped: () => 0,
    netTiming: () => null,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as FakeTimer).cleared = true;
    },
    ...overrides,
  };
  return {
    tracker: createOpenSessionTracker(deps),
    timers,
    advance(ms: number) {
      perf += ms;
      wall += ms;
    },
    wallIso: (offsetMs = 0) => new Date(wall + offsetMs).toISOString(),
    records: () => stashed.map((report) => JSON.parse(report.detail ?? "{}") as Record<string, unknown>),
    stashed,
  };
}

function syncEntry(at: string, overrides: Partial<SyncTimingEntry> = {}): SyncTimingEntry {
  return {
    at,
    outcome: "pull_only",
    totalMs: 900,
    phases: { status: 600, pull: 300 },
    reason: "resume",
    waitMs: 50,
    connection: "open",
    protocol: "h2",
    ...overrides,
  };
}

describe("打开会话收集器", () => {
  // 冷启动的起点是页面导航那一刻（startedAt: 0），而收集器要到 React 挂载才被调用——两者之间
  // 差着整个启动耗时。墙钟起点必须把这段扣掉，否则导航之后、挂载之前落账的那一轮同步会被当成
  // 「转后台前发起的陈旧轮」丢弃，冷启动会话的 sync 永远为 null、三件事齐不了，只能拖到 20 s 上限
  // ——报告 M3 的冷启动行会显示「> 20 s」，读的人会以为冷启动根本等不到新数据（终审 L2-F1）。
  it("冷启动的墙钟起点要扣掉已过去的时间：导航之后、挂载之前落账的同步轮算数", () => {
    const h = harness();
    // now() 此刻是 10_000，startedAt 取 0 → 已过去 10 秒；墙钟起点应回推到 10 秒前
    h.tracker.begin({ kind: "cold", startedAt: 0, cause: "cold", hiddenMs: null, trigger: null });
    // 这一轮同步在「5 秒前」落账——晚于导航、早于挂载，属于这次打开
    h.tracker.syncRecorded(syncEntry(h.wallIso(-5_000)));
    h.tracker.probeLanded(10_500);
    h.tracker.storageSettled(12, null);
    expect(h.records()).toHaveLength(1);
    expect(h.records()[0]).toMatchObject({ kind: "cold", endedBy: "complete" });
    expect(h.records()[0].syncMs).toBe(10_000);
  });

  it("真正陈旧的那一轮仍然要丢：落账时刻早于墙钟起点就不算", () => {
    const h = harness();
    h.tracker.begin({ kind: "cold", startedAt: 0, cause: "cold", hiddenMs: null, trigger: null });
    // 「15 秒前」落账——早于导航时刻（10 秒前），是上一次打开留下的
    h.tracker.syncRecorded(syncEntry(h.wallIso(-15_000)));
    h.tracker.probeLanded(10_500);
    h.tracker.storageSettled(12, null);
    expect(h.records()).toHaveLength(0); // 三件事没齐，还挂着
  });

  it("探针落地 + 存储回来 + 同步落账三者齐 → complete，恰好一条", () => {
    const h = harness({ takeDropped: () => 2, netTiming: () => ({ connectMs: 240, ttfbMs: 350, xferMs: 20, reused: false }) });
    const id = h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: 3_600_000, trigger: "visibilitychange" });
    h.advance(120);
    h.tracker.probeLanded(10_120);
    h.tracker.storageSettled(180.4, null);
    h.advance(1_500);
    h.tracker.syncRecorded(syncEntry(h.wallIso(-1_400)));

    expect(h.records()).toEqual([
      {
        id,
        build: "build-1",
        kind: "resume",
        cause: null,
        hiddenMs: 3_600_000,
        ttiMs: 120,
        stall: null,
        syncMs: 1_620,
        sync: { outcome: "pull_only", reason: "resume", waitMs: 50, totalMs: 900, phases: { status: 600, pull: 300 }, connection: "open", protocol: "h2" },
        net: { connectMs: 240, ttfbMs: 350, xferMs: 20, reused: false },
        storageMs: 180,
        storageErr: null,
        resumes: 1,
        trigger: "visibilitychange",
        endedBy: "complete",
        dropped: 2,
      },
    ]);
    expect(h.tracker.activeId()).toBeNull();
    expect(h.timers[0].cleared).toBe(true);
  });

  // 逃逸变异：收尾后不置空 active → 后续事件再 stash 一条，报告里一次打开算两次。
  it("收尾之后的事件全部忽略，不再 stash", () => {
    const h = harness();
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: null });
    h.tracker.end("hidden");
    h.tracker.probeLanded(10_050);
    h.tracker.syncRecorded(syncEntry(h.wallIso(10)));
    h.tracker.end("reload");
    expect(h.stashed).toHaveLength(1);
    expect(h.records()[0]).toMatchObject({ endedBy: "hidden", ttiMs: null, syncMs: null });
  });

  it("20 s 到点 → cap，未到的字段为 null；定时时长按已过去的时间扣减", () => {
    const h = harness();
    h.tracker.begin({ kind: "cold", startedAt: 0, cause: "watchdog", hiddenMs: null, trigger: null });
    expect(h.timers[0].ms).toBe(OPEN_SESSION_CAP_MS - 10_000); // 冷启动 begin 时已离导航起点 10 s
    h.tracker.probeLanded(10_200);
    h.timers[0].fn();
    expect(h.records()[0]).toMatchObject({ kind: "cold", cause: "watchdog", ttiMs: 10_200, syncMs: null, endedBy: "cap" });
  });

  it("stall 有结论也算探针结束：reload 收尾带上 stall", () => {
    const h = harness();
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: null });
    h.advance(6_000);
    h.tracker.stallDecided("reload");
    h.tracker.end("reload");
    expect(h.records()[0]).toMatchObject({ stall: "reload", ttiMs: null, endedBy: "reload" });
  });

  // 上面那条是假闸：它走的是 end("reload")，收尾与「探针有没有结论」根本无关——把 tryComplete 里
  // `|| session.stall !== null` 删掉它照样绿（执行器实测并如实报了）。这一条才走到被守护的那个分支：
  // 探针永远没落地，stall 是「探针这条线有结论」的唯一来源；没有它，三件事永远齐不了，
  // 这次打开只能挂到 20 s 上限才收尾——把一次「卡了一下但自己好了」记成「一直没等到」。
  it("探针没落地、只有 stall 结论：另两件事齐了就 complete，不拖到上限", () => {
    const h = harness();
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: null });
    h.advance(1_000);
    h.tracker.stallDecided("recovered");
    h.tracker.storageSettled(12, null);
    h.tracker.syncRecorded(syncEntry(h.wallIso()));
    expect(h.records()).toHaveLength(1);
    expect(h.records()[0]).toMatchObject({ stall: "recovered", ttiMs: null, endedBy: "complete" });
  });

  // 逃逸变异：去掉陈旧过滤 → 转后台前就开始、回前台才落账的那轮同步被算成本次打开的「新数据到达」。
  it("会话开始之前就发起的同步轮不算", () => {
    const h = harness();
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: null });
    h.tracker.syncRecorded(syncEntry(h.wallIso(-5_000)));
    h.tracker.probeLanded(10_010);
    h.tracker.storageSettled(5, null);
    expect(h.stashed).toHaveLength(0);
    h.tracker.syncRecorded(syncEntry(h.wallIso(50)));
    expect(h.stashed).toHaveLength(1);
  });

  it("只取会话开始后的第一条同步记录", () => {
    const h = harness();
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: null });
    h.tracker.syncRecorded(syncEntry(h.wallIso(10), { totalMs: 1 }));
    h.tracker.syncRecorded(syncEntry(h.wallIso(20), { totalMs: 2 }));
    h.tracker.end("hidden");
    expect((h.records()[0].sync as { totalMs: number }).totalMs).toBe(1);
  });

  it("noteResume 累加条数并更新最后来源", () => {
    const h = harness();
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: "visibilitychange" });
    h.tracker.noteResume("focus");
    h.tracker.noteResume("appStateChange");
    h.tracker.end("hidden");
    expect(h.records()[0]).toMatchObject({ resumes: 3, trigger: "appStateChange" });
  });

  it("存储出错：storageMs 为 null、记错误名；只认第一次", () => {
    const h = harness();
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: null });
    h.tracker.storageSettled(null, "UnknownError");
    h.tracker.storageSettled(12, null);
    h.tracker.end("hidden");
    expect(h.records()[0]).toMatchObject({ storageMs: null, storageErr: "UnknownError" });
  });

  it("会话还开着又 begin：旧的按 hidden 收尾，新的照常开", () => {
    const h = harness();
    h.tracker.begin({ kind: "cold", startedAt: 0, cause: "cold", hiddenMs: null, trigger: null });
    const second = h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: 10, trigger: null });
    expect(h.records()[0]).toMatchObject({ kind: "cold", endedBy: "hidden" });
    expect(h.tracker.activeId()).toBe(second);
  });

  it("stash 抛错被吞，会话照样关闭", () => {
    const h = harness({
      stash: () => {
        throw new Error("storage full");
      },
    });
    h.tracker.begin({ kind: "resume", startedAt: 10_000, cause: null, hiddenMs: null, trigger: null });
    expect(() => h.tracker.end("hidden")).not.toThrow();
    expect(h.tracker.activeId()).toBeNull();
  });
});

describe("buildOpenSessionReport", () => {
  it("超长时先丢 net，再清 sync.phases，带 trunc，≤ 1000", () => {
    const report = buildOpenSessionReport({
      id: "x",
      build: "b".repeat(600), // 全量 1006 字符，丢 net 后 972
      kind: "resume",
      cause: null,
      hiddenMs: 1,
      ttiMs: 1,
      stall: null,
      syncMs: 1,
      sync: { outcome: "pushed", reason: "resume", waitMs: 1, totalMs: 1, phases: { status: 1, pull: 2, push: 3, bumpApply: 4 }, connection: "open", protocol: "h2" },
      net: { connectMs: 1, ttfbMs: 1, xferMs: 1, reused: true },
      storageMs: 1,
      storageErr: null,
      resumes: 1,
      trigger: null,
      endedBy: "complete",
      dropped: 0,
    });
    const detail = JSON.parse(report.detail ?? "{}") as Record<string, unknown>;
    expect(report.action).toBe("open_session");
    expect(report.detail?.length ?? 0).toBeLessThanOrEqual(SYNC_LOG_DETAIL_MAX);
    expect(detail.net).toBeNull();
    expect(detail.trunc).toBe(true);
  });
});
