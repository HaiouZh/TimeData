import { describe, expect, it } from "vitest";
import type { RecoveryKV } from "./kv.js";
import {
  PENDING_REPORTS_MAX,
  type PendingReport,
  clearPendingReports,
  readPendingReports,
  sendWithPending,
  stashPendingReport,
} from "./pendingReports.js";

function fakeKV(initial: Record<string, string> = {}): RecoveryKV {
  const store = { ...initial };
  return {
    get: (key) => store[key] ?? null,
    set: (key, value) => {
      store[key] = value;
    },
    remove: (key) => {
      delete store[key];
    },
  };
}

describe("待发送埋点", () => {
  it("攒起来按顺序读出", () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", detail: "a", record_count: 0 }, kv);
    stashPendingReport({ action: "cold_start", detail: "b", record_count: 0 }, kv);
    expect(readPendingReports(kv).map((r) => r.detail)).toEqual(["a", "b"]);
  });

  it("超量丢最旧的——观测数据宁可丢老的也不能无限涨", () => {
    const kv = fakeKV();
    for (let i = 0; i < PENDING_REPORTS_MAX + 3; i += 1) {
      stashPendingReport({ action: "cold_start", detail: String(i), record_count: 0 }, kv);
    }
    const details = readPendingReports(kv).map((r) => r.detail);
    expect(details).toHaveLength(PENDING_REPORTS_MAX);
    expect(details[0]).toBe("3");
  });

  it("清空后读出空数组", () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", record_count: 0 }, kv);
    clearPendingReports(kv);
    expect(readPendingReports(kv)).toEqual([]);
  });

  it("坏 JSON 当空，不抛", () => {
    expect(readPendingReports(fakeKV({ timedata_pending_reports: "{坏" }))).toEqual([]);
  });

  it("坏元素被逐个丢掉，不传染整份", () => {
    const kv = fakeKV({ timedata_pending_reports: '[{"action":"ok"},{"nope":1},"字符串"]' });
    expect(readPendingReports(kv)).toEqual([{ action: "ok" }]);
  });
});

describe("搭车上报", () => {
  it("攒着的排在本次日志前面一起发", async () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", detail: "旧" }, kv);
    let received: PendingReport[] = [];
    await sendWithPending([{ action: "push" }], async (all) => {
      received = all;
    }, kv);
    expect(received).toEqual([{ action: "cold_start", detail: "旧" }, { action: "push" }]);
  });

  it("发成功才清空", async () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", detail: "旧" }, kv);
    await sendWithPending([{ action: "push" }], async () => undefined, kv);
    expect(readPendingReports(kv)).toEqual([]);
  });

  it("发失败留着下次搭车，不丢", async () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", detail: "旧" }, kv);
    await expect(
      sendWithPending([{ action: "push" }], async () => {
        throw new Error("网络请求失败：");
      }, kv),
    ).rejects.toThrow("网络请求失败：");
    expect(readPendingReports(kv)).toEqual([{ action: "cold_start", detail: "旧" }]);
  });

  it("没有攒着的就原样发，不动存储", async () => {
    const kv = fakeKV();
    let received: PendingReport[] = [];
    await sendWithPending([{ action: "push" }], async (all) => {
      received = all;
    }, kv);
    expect(received).toEqual([{ action: "push" }]);
  });
});
