import { describe, expect, it } from "vitest";
import {
  SYNC_TIMINGS_MAX,
  type SyncTimingEntry,
  type TimingsKV,
  createPhaseRecorder,
  getSyncTimings,
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
