import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import {
  SYNC_TIMINGS_MAX,
  type SyncTimingEntry,
  type TimingsKV,
  createPhaseRecorder,
  getSyncTimings,
  readSyncTransportProtocol,
  recordSyncTiming,
  timingTotalsPercentiles,
} from "./phaseTimings.js";

// in-memory KV：不碰真实 localStorage，遵循桶纪律。
function createMemoryKV(): TimingsKV {
  const store = new Map<string, string>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function makeEntry(overrides: Partial<SyncTimingEntry> = {}): SyncTimingEntry {
  return {
    at: "2026-07-02T00:00:00.000Z",
    outcome: "identical",
    totalMs: 100,
    phases: {},
    ...overrides,
  };
}

describe("createPhaseRecorder", () => {
  it("记录 time() 耗时并透传返回值", async () => {
    const ticks = [0, 120, 120, 370];
    let i = 0;
    const now = () => ticks[i++];
    const recorder = createPhaseRecorder(now);

    const result = await recorder.time("status", async () => "ok");

    expect(result).toBe("ok");
    expect(recorder.phases.status).toBe(120);
  });

  it("fn reject 时异常照抛，仍记录耗时", async () => {
    const ticks = [0, 50];
    let i = 0;
    const now = () => ticks[i++];
    const recorder = createPhaseRecorder(now);

    await expect(
      recorder.time("push", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(recorder.phases.push).toBe(50);
  });
});

describe("readSyncTransportProtocol", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("取最近一条 /api/sync/ 资源的 nextHopProtocol", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "https://x/api/other", nextHopProtocol: "http/1.1" },
      { name: "https://x/api/sync/pull", nextHopProtocol: "h2" },
    ] as unknown as PerformanceResourceTiming[]);

    expect(readSyncTransportProtocol()).toBe("h2");
  });

  it("无匹配资源或 API 缺失时返回 undefined 且不抛", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    expect(readSyncTransportProtocol()).toBeUndefined();
  });
});

describe("recordSyncTiming / getSyncTimings", () => {
  it("环形缓冲最多留 20 条，最新在前", () => {
    const kv = createMemoryKV();
    for (let n = 0; n < 21; n++) {
      recordSyncTiming(makeEntry({ totalMs: n }), kv);
    }

    const entries = getSyncTimings(kv);
    expect(entries).toHaveLength(SYNC_TIMINGS_MAX);
    expect(entries[0].totalMs).toBe(20); // 最新一条在前
    expect(entries[entries.length - 1].totalMs).toBe(1); // 最早的一条（0 已被挤出）
  });

  it("KV 里是坏 JSON 时返回 []", () => {
    const kv = createMemoryKV();
    kv.set("timedata_sync_phase_timings", "{not json");

    expect(getSyncTimings(kv)).toEqual([]);
  });

  it("数组元素 shape 损坏时丢弃坏元素只留合法项", () => {
    const kv = createMemoryKV();
    const good: SyncTimingEntry = {
      at: "2026-07-02T00:00:00.000Z",
      outcome: "pushed",
      totalMs: 120,
      phases: { push: 60, health: 20 } as SyncTimingEntry["phases"],
    };
    kv.set(
      STORAGE_KEYS.syncPhaseTimings,
      JSON.stringify([
        good,
        { at: "2026-07-02T00:00:01.000Z" }, // 缺 outcome/totalMs/phases
        { ...good, totalMs: "slow" }, // totalMs 非数字
        { ...good, phases: null }, // phases 非对象
        { ...good, phases: { push: "fast" } }, // phase 值非数字
        "not-an-object",
      ]),
    );

    expect(getSyncTimings(kv)).toEqual([good]);
  });

  it("protocol 字段随 entry 落盘并通过 shape 校验", () => {
    const kv = createMemoryKV();
    recordSyncTiming(makeEntry({ protocol: "h3" }), kv);

    expect(getSyncTimings(kv)[0].protocol).toBe("h3");
  });

  it("protocol 非 string 的坏元素被丢弃", () => {
    const kv = createMemoryKV();
    const good: SyncTimingEntry = {
      at: "2026-07-02T00:00:00.000Z",
      outcome: "pushed",
      totalMs: 120,
      phases: { push: 60 },
      protocol: "h2",
    };
    kv.set(
      STORAGE_KEYS.syncPhaseTimings,
      JSON.stringify([
        good,
        // biome-ignore lint/suspicious/noExplicitAny: 模拟 localStorage 里 protocol 字段被污染成非字符串
        { ...good, protocol: 42 } as any,
      ]),
    );

    expect(getSyncTimings(kv)).toEqual([good]);
  });
});

describe("timingTotalsPercentiles", () => {
  it("按最近邻 rank 法计算 p50/p95", () => {
    const entries = [100, 200, 300, 400].map((totalMs) => makeEntry({ totalMs }));
    expect(timingTotalsPercentiles(entries)).toEqual({ p50: 200, p95: 400 });
  });

  it("少于 2 条返回 null", () => {
    expect(timingTotalsPercentiles([])).toBeNull();
    expect(timingTotalsPercentiles([makeEntry()])).toBeNull();
  });
});
