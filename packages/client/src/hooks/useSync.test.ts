// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPendingReports } from "../lib/recovery/pendingReports.ts";
import { getSyncTimings } from "../sync/phaseTimings.ts";
import { renderDom, unmount } from "../test/domHarness.js";
import { getSyncRetryAfterMs, shouldAutoSyncOnMount, shouldShowSyncDiagnosticsHint, useSync } from "./useSync.js";

vi.mock("../sync/engine.ts", () => ({
  getConsecutiveSyncFailureCount: () => 0,
  getSyncHealth: vi.fn(),
  prepareForcePush: vi.fn(),
  regularSync: vi.fn(),
  syncForcePushToServer: vi.fn(),
  syncForceReplace: vi.fn(),
}));

vi.mock("../lib/tasks.ts", () => ({
  hasDeferredMaterialization: vi.fn(() => false),
  runMaterialization: vi.fn(async () => {}),
}));

vi.mock("../sync/conflicts.ts", () => ({
  resolveConflicts: vi.fn(),
}));

vi.mock("../db/index.ts", () => ({
  db: {
    syncLog: {
      where: () => ({ equals: () => ({ count: async () => 0 }) }),
    },
  },
}));

beforeEach(() => {
  localStorage.clear();
});

describe("shouldShowSyncDiagnosticsHint", () => {
  it("shows diagnostics hint only when sync has failed repeatedly", () => {
    expect(shouldShowSyncDiagnosticsHint(0)).toBe(false);
    expect(shouldShowSyncDiagnosticsHint(2)).toBe(false);
    expect(shouldShowSyncDiagnosticsHint(3)).toBe(true);
  });
});

describe("shouldAutoSyncOnMount", () => {
  it("only allows automatic sync when both server and cloud sync are enabled", () => {
    expect(shouldAutoSyncOnMount("https://example.com", true)).toBe(true);
    expect(shouldAutoSyncOnMount("https://example.com", false)).toBe(false);
    expect(shouldAutoSyncOnMount("", true)).toBe(false);
    expect(shouldAutoSyncOnMount(null, true)).toBe(false);
  });
});

describe("getSyncRetryAfterMs", () => {
  it("reads the current server rate-limit response body", () => {
    expect(getSyncRetryAfterMs({ status: 429, body: { retryAfterSec: 7 } })).toBe(7_000);
  });

  it("accepts Retry-After seconds or date when headers are available", () => {
    expect(getSyncRetryAfterMs({ headers: { get: () => "5" } }, 1_000)).toBe(5_000);
    expect(getSyncRetryAfterMs({ headers: { get: () => "Thu, 01 Jan 1970 00:00:06 GMT" } }, 1_000)).toBe(5_000);
  });
});

describe("useSync", () => {
  it("returns the same object reference across unrelated parent rerenders", async () => {
    const seenValues: unknown[] = [];
    let triggerUnrelatedRerender: () => void = () => undefined;

    function Probe() {
      seenValues.push(useSync());
      return createElement("span", null, "probe");
    }

    function Wrapper() {
      const [unrelated, setUnrelated] = useState(0);
      triggerUnrelatedRerender = () => setUnrelated((value) => value + 1);
      return createElement("div", { "data-unrelated": unrelated }, createElement(Probe));
    }

    const { root } = await renderDom(createElement(Wrapper));

    const initialValue = seenValues.at(-1);

    await act(async () => {
      triggerUnrelatedRerender();
    });

    expect(seenValues.at(-1)).toBe(initialValue);

    await unmount(root);
  });

  it("sync 成功后落一条分段计时记录，不含 health 阶段耗时", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.mocked(regularSync).mockResolvedValueOnce({
      checked: true,
      identical: true,
      pushed: 0,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 0,
      conflicts: [],
    });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync();
    });

    const timings = getSyncTimings();
    expect(timings).toHaveLength(1);
    expect(timings[0].outcome).not.toBe("error");
    expect(timings[0].phases.health).toBeUndefined();

    await unmount(root);
  });

  it("sync(meta) 透传 waitMs/reason/connection 到落账记录", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.mocked(regularSync).mockResolvedValueOnce({
      checked: true,
      identical: true,
      pushed: 0,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 0,
      conflicts: [],
    });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync({ reason: "bump", waitMs: 250, connection: "connected" });
    });

    const timings = getSyncTimings();
    expect(timings).toHaveLength(1);
    expect(timings[0].reason).toBe("bump");
    expect(timings[0].waitMs).toBe(250);
    expect(timings[0].connection).toBe("connected");
    expect(timings[0].unsyncedAtStart).toBe(0);

    await unmount(root);
  });

  it("Android resume sync selects native transport and records it", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(true);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "https://example.com/api/sync/status", nextHopProtocol: "h2" },
    ] as PerformanceResourceTiming[]);
    vi.mocked(regularSync).mockResolvedValueOnce({
      checked: true,
      identical: true,
      pushed: 0,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 0,
      conflicts: [],
    });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync({ reason: "resume", waitMs: 0 });
    });

    expect(regularSync).toHaveBeenCalledWith(expect.objectContaining({ transport: "native-android", dualLane: true }));
    expect(getSyncTimings()[0].transport).toBe("native-android");
    expect(getSyncTimings()[0].protocol).toBeUndefined();

    await unmount(root);
  });

  it("Android resume sync records web when CapacitorHttp is unavailable", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(false);
    vi.mocked(regularSync).mockResolvedValueOnce({
      checked: true,
      identical: true,
      pushed: 0,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 0,
      conflicts: [],
    });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync({ reason: "resume", waitMs: 0 });
    });

    expect(regularSync).toHaveBeenCalledWith(expect.objectContaining({ transport: "web", dualLane: false }));
    expect(getSyncTimings()[0].transport).toBe("web");

    await unmount(root);
  });

  it("同步开头的本地计数报错：黄灯照样复位，本轮记为失败", async () => {
    const { db } = await import("../db/index.ts");
    const { regularSync } = await import("../sync/engine.ts");
    vi.mocked(regularSync).mockClear();
    const original = db.syncLog.where;

    try {
      const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
      function Probe() {
        captured.value = useSync();
        return createElement("span", null, "probe");
      }
      const { root } = await renderDom(createElement(Probe));

      // 挂载后再换桩、且只抛一次：只让 sync() 开头那次计数报错，挂载与收尾的刷新照常
      let thrown = false;
      db.syncLog.where = ((index: string) => {
        if (thrown) return original.call(db.syncLog, index);
        thrown = true;
        return {
          equals: () => ({
            count: async () => {
              throw new Error("DatabaseClosedError");
            },
          }),
        };
      }) as unknown as typeof original;

      await act(async () => {
        await captured.value?.sync();
      });

      expect(captured.value?.syncing).toBe(false);
      expect(captured.value?.error).toBeTruthy();
      expect(regularSync).not.toHaveBeenCalled();
      expect(getSyncTimings()[0].outcome).toBe("error");

      await unmount(root);
    } finally {
      db.syncLog.where = original;
    }
  });

  it("本轮发过第二车道：lanes 落进计时记录", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    const identical = {
      checked: true,
      identical: true,
      pushed: 0,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 0,
      conflicts: [],
    };
    // syncFailures 是模块级单例：先跑一轮普通成功清掉前面用例留下的连败，再清掉它攒的上报。
    vi.mocked(regularSync).mockResolvedValueOnce(identical);
    vi.mocked(regularSync).mockImplementationOnce(async (options) => {
      if (options?.phases) options.phases.lanes = { backupFired: 1, backupWon: 1 };
      return {
        checked: true,
        identical: true,
        pushed: 0,
        rejected: 0,
        pushConflicts: 0,
        pushIssues: [],
        pulled: 0,
        conflicts: [],
      };
    });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync();
    });
    localStorage.clear();
    await act(async () => {
      await captured.value?.sync({ reason: "write", waitMs: 0 });
    });

    expect(getSyncTimings()[0].lanes).toEqual({ backupFired: 1, backupWon: 1 });
    expect(readPendingReports().map((r) => r.action)).toEqual(["sync_lane_rescue"]);

    await unmount(root);
  });

  it("失败轮发过第二车道：sync_error 也带上本轮 lanes", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.mocked(regularSync).mockImplementationOnce(async (options) => {
      if (options?.phases) options.phases.lanes = { backupFired: 2, backupWon: 0 };
      throw new Error("网络请求超时（15000ms）：/api/sync/pull");
    });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync({ reason: "write", waitMs: 0 });
    });

    const report = readPendingReports().find((r) => r.action === "sync_error");
    expect(report).toBeDefined();
    expect(JSON.parse(report?.detail ?? "{}").lanes).toEqual({ backupFired: 2, backupWon: 0 });

    await unmount(root);
  });

  it("regularSync 抛错时也落一条 outcome=error 的计时记录", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.mocked(regularSync).mockRejectedValueOnce(new Error("网络请求失败：boom"));

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync();
    });

    expect(captured.value?.error).toBeTruthy();

    const timings = getSyncTimings();
    expect(timings).toHaveLength(1);
    expect(timings[0].outcome).toBe("error");

    await unmount(root);
  });

  it("失败轮攒一条 sync_error，随后首次成功攒一条 sync_recovered", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.mocked(regularSync)
      .mockRejectedValueOnce(new Error("网络请求超时（10000ms）：https://example.com/api/sync/status"))
      .mockResolvedValueOnce({
        checked: true,
        identical: true,
        pushed: 0,
        rejected: 0,
        pushConflicts: 0,
        pushIssues: [],
        pulled: 0,
        conflicts: [],
      });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    await act(async () => {
      await captured.value?.sync({ reason: "resume", waitMs: 40 });
    });
    await act(async () => {
      await captured.value?.sync({ reason: "reconnect", waitMs: 0 });
    });

    const reports = readPendingReports();
    expect(reports.map((r) => r.action)).toEqual(["sync_error", "sync_recovered"]);
    expect(JSON.parse(reports[0].detail ?? "{}")).toMatchObject({ reason: "resume", kind: "timeout", waitMs: 40 });
    expect(JSON.parse(reports[1].detail ?? "{}")).toMatchObject({ reason: "reconnect" });

    await unmount(root);
  });

  it("429 失败把服务端 retryAfterSec 作为内部 executor 结果返回", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    vi.mocked(regularSync).mockRejectedValueOnce({
      status: 429,
      body: { error: "rate_limited", retryAfterSec: 9 },
    });

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));

    let outcome: unknown;
    await act(async () => {
      outcome = await captured.value?.sync();
    });

    expect(outcome).toEqual({ ok: false, retryAfterMs: 9_000 });
    await unmount(root);
  });
});

describe("对账完成后补跑物化（物化闸的另一半）", () => {
  // 闸挡住了冷启动那次物化；对完账必须补跑一次，否则单设备用户在切走又切回之前
  // 根本看不到今天的重复任务。
  async function syncOnce() {
    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const { root } = await renderDom(createElement(Probe));
    await act(async () => {
      await captured.value?.sync();
    });
    return root;
  }

  it("闸拦下过（有欠账）时，同步成功后补跑 runMaterialization", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    const { hasDeferredMaterialization, runMaterialization } = await import("../lib/tasks.ts");
    vi.mocked(runMaterialization).mockClear();
    vi.mocked(hasDeferredMaterialization).mockReturnValue(true);
    vi.mocked(regularSync).mockResolvedValueOnce({
      checked: true,
      identical: true,
      pushed: 0,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 0,
      conflicts: [],
    });

    const root = await syncOnce();

    expect(vi.mocked(runMaterialization)).toHaveBeenCalled();
    await unmount(root);
  });

  it("同步失败但有欠账时同样补跑：闸已解，离线设备照常看到今天的重复任务", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    const { hasDeferredMaterialization, runMaterialization } = await import("../lib/tasks.ts");
    vi.mocked(runMaterialization).mockClear();
    vi.mocked(hasDeferredMaterialization).mockReturnValue(true);
    vi.mocked(regularSync).mockRejectedValueOnce(new Error("网络请求失败：boom"));

    const root = await syncOnce();

    expect(vi.mocked(runMaterialization)).toHaveBeenCalled();
    await unmount(root);
  });

  it("没有欠账就不打扰：每轮同步都补跑会在关键路径上塞一次 Dexie 全表扫，打乱别的页面时序", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    const { hasDeferredMaterialization, runMaterialization } = await import("../lib/tasks.ts");
    vi.mocked(runMaterialization).mockClear();
    vi.mocked(hasDeferredMaterialization).mockReturnValue(false);
    vi.mocked(regularSync).mockResolvedValueOnce({
      checked: true,
      identical: true,
      pushed: 0,
      rejected: 0,
      pushConflicts: 0,
      pushIssues: [],
      pulled: 0,
      conflicts: [],
    });

    const root = await syncOnce();

    expect(vi.mocked(runMaterialization)).not.toHaveBeenCalled();
    await unmount(root);
  });
});
