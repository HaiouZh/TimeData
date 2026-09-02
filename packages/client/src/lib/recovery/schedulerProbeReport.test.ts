import { describe, expect, it } from "vitest";
import type { RecoveryKV } from "./kv.js";
import { bumpProbeCount, buildSchedulerProbeReport } from "./schedulerProbeReport.js";

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
    const report = buildSchedulerProbeReport({
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
    expect(report.action).toBe("scheduler_probe");
    expect(report.record_count).toBe(0);
    expect(JSON.parse(report.detail ?? "")).toEqual({
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
  });
});

describe("bumpProbeCount", () => {
  // 真闸：累计值必须落在 KV 里跨重载存活——改成模块变量，第二个 KV 读不到 3 就红。
  it("累计值存在 KV 里，跨「重载」（新实例、同 KV）继续累加", () => {
    const kv = memoryKV();
    expect(bumpProbeCount(kv)).toBe(1);
    expect(bumpProbeCount(kv)).toBe(2);
    const afterReload = memoryKV({ timedata_scheduler_probes: kv.get("timedata_scheduler_probes") ?? "" });
    expect(bumpProbeCount(afterReload)).toBe(3);
  });

  it("KV 里是坏值时从 1 重新数，不抛错", () => {
    expect(bumpProbeCount(memoryKV({ timedata_scheduler_probes: "abc" }))).toBe(1);
    expect(bumpProbeCount(memoryKV({ timedata_scheduler_probes: "-4" }))).toBe(1);
  });
});
