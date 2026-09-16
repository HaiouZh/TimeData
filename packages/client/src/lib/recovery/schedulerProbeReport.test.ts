import { describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../storageKeys.js";
import type { RecoveryKV } from "./kv.js";
import { bumpProbeCount, buildSchedulerProbeReport, type SchedulerProbeInput } from "./schedulerProbeReport.js";
import { SYNC_LOG_DETAIL_MAX } from "./pendingReports.js";

function memoryKV(seed: Record<string, string> = {}): RecoveryKV {
  const store = new Map(Object.entries(seed));
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => void store.set(k, v),
    remove: (k) => void store.delete(k),
  };
}

describe("buildSchedulerProbeReport", () => {
  it("拼成 sync_logs 一行：action 固定、detail 是完整现场 JSON、record_count 为 0", () => {
    const input = fullInput({
      outcome: "held",
      hadPort: true,
      kicked: true,
      recovered: false,
      visible: "hidden",
      waitedMs: 5012,
      probes: 7,
      maxGapMs: 0,
      sinceBootMs: 123456,
      storageMs: 18,
      resumes: 1,
      trigger: "visibilitychange",
    });
    const report = buildSchedulerProbeReport(input);
    expect(report.action).toBe("scheduler_probe");
    expect(report.record_count).toBe(0);
    expect(JSON.parse(report.detail ?? "")).toEqual(input);
  });
});

describe("bumpProbeCount", () => {
  // 真闸：累计值必须落在 KV 里跨重载存活——改成模块变量，第二个 KV 读不到 3 就红。
  it("累计值存在 KV 里，跨「重载」（模块重新求值、同 KV）继续累加", async () => {
    const kv = memoryKV();
    expect(bumpProbeCount(kv)).toBe(1);
    expect(bumpProbeCount(kv)).toBe(2);
    // 重载 = 模块从头求值：模块变量归零、只有 KV 里的值还在。同进程里不重置模块，模块变量也会延续，闸就是假的。
    vi.resetModules();
    const fresh = await import("./schedulerProbeReport.js");
    const afterReload = memoryKV({ [STORAGE_KEYS.schedulerProbes]: kv.get(STORAGE_KEYS.schedulerProbes) ?? "" });
    expect(fresh.bumpProbeCount(afterReload)).toBe(3);
  });

  it("KV 里是坏值时从 1 重新数，不抛错", () => {
    expect(bumpProbeCount(memoryKV({ [STORAGE_KEYS.schedulerProbes]: "abc" }))).toBe(1);
    expect(bumpProbeCount(memoryKV({ [STORAGE_KEYS.schedulerProbes]: "-4" }))).toBe(1);
  });

  it("KV 里是小数时先取整再加——probes 永远是整数", () => {
    expect(bumpProbeCount(memoryKV({ [STORAGE_KEYS.schedulerProbes]: "41.5" }))).toBe(42);
  });
});

function fullInput(overrides: Partial<SchedulerProbeInput> = {}): SchedulerProbeInput {
  return {
    outcome: "reload",
    hadPort: true,
    kicked: true,
    recovered: false,
    visible: "visible",
    waitedMs: 5012,
    probes: 163,
    maxGapMs: 114,
    sinceBootMs: 23835167,
    storageMs: -1,
    resumes: 4,
    trigger: "appStateChange",
    id: "k3j9x0a1bz",
    sessionId: "q8w7e6r5t4",
    build: "a1b2c3d4e5f6a7b8c9d0",
    paired: true,
    delivered: false,
    pendingMsgMs: 5230,
    direct: "ran",
    rootPre: { p: 262400, s: 262144, pg: 0, cb: false, cpc: false },
    rootPost: { p: 262400, s: 262144, pg: 0, cb: false, cpc: false },
    lazy: [
      ["SettingsTodoStatsLayoutPage", 612345],
      ["SettingsCategoryDetailPage", 4123],
      ["SettingsAdminInsightsPage", 88],
    ],
    storageErr: "DatabaseClosedError/UnknownError",
    dbOpen: false,
    ...overrides,
  };
}

describe("buildSchedulerProbeReport（ios-instant-open 阶段1 §2.7）", () => {
  // 前身残留账 Q1：手拼输入漏字段时 TS 与 toMatchObject 都不报——这里用 toEqual 钉全字段形状。
  it("现实极端输入（字段全满）原样写入，不降级且 ≤ 1000", () => {
    const report = buildSchedulerProbeReport(fullInput());
    expect(report.action).toBe("scheduler_probe");
    expect(report.detail?.length ?? 0).toBeLessThanOrEqual(SYNC_LOG_DETAIL_MAX);
    expect(JSON.parse(report.detail ?? "{}")).toEqual(fullInput());
  });

  // 逃逸变异：去掉降级 → 超长 detail 被 stash 拒收，这条现场整条丢。
  it("超长时按 lazy → rootPre → storageErr 顺序降级，带 trunc，结果 ≤ 1000", () => {
    const long = "P".repeat(300);
    const report = buildSchedulerProbeReport(
      fullInput({ lazy: [[long, 1], [long, 2], [long, 3]] }),
    );
    const detail = JSON.parse(report.detail ?? "{}") as Record<string, unknown>;
    expect(report.detail?.length ?? 0).toBeLessThanOrEqual(SYNC_LOG_DETAIL_MAX);
    expect(detail.trunc).toBe(true);
    expect(detail.lazy).toEqual([]);
    expect(detail.rootPre).toEqual(fullInput().rootPre); // 第一步已够，后面的不动
  });

  it("第一步不够时继续丢 rootPre", () => {
    const report = buildSchedulerProbeReport(
      fullInput({ lazy: [["L".repeat(900), 1]], trigger: "T".repeat(700) }),
    );
    const detail = JSON.parse(report.detail ?? "{}") as Record<string, unknown>;
    expect(detail.lazy).toEqual([]);
    expect(detail.rootPre).toBeNull();
    expect(detail.trunc).toBe(true);
  });
});
