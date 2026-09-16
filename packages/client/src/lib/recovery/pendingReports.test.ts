import { describe, expect, it } from "vitest";
import type { RecoveryKV } from "./kv.js";
import {
  PENDING_REPORTS_MAX,
  type PendingReport,
  SYNC_LOG_BATCH_MAX,
  SYNC_LOG_DETAIL_MAX,
  clearPendingReports,
  readPendingReports,
  removeSentReports,
  sendWithPending,
  stashPendingReport,
  takeDroppedReportCount,
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

describe("上报通道加固（ios-instant-open 阶段1 §4）", () => {
  it("容量 30：每次打开一条 open_session，5 条会挤掉早记录", () => {
    expect(PENDING_REPORTS_MAX).toBe(30);
  });

  // 逃逸变异：去掉长度检查 → 超长条目进队列，整批 400 毒死队列。
  it("detail 超过服务端上限的条目拒收，并计入丢失计数", () => {
    const kv = fakeKV();
    const accepted = stashPendingReport({ action: "scheduler_probe", detail: "x".repeat(SYNC_LOG_DETAIL_MAX + 1) }, kv);
    expect(accepted).toBe(false);
    expect(readPendingReports(kv)).toEqual([]);
    expect(takeDroppedReportCount(kv)).toBe(1);
    expect(takeDroppedReportCount(kv)).toBe(0); // 读后清零
  });

  it("恰好 1000 字符照收", () => {
    const kv = fakeKV();
    expect(stashPendingReport({ action: "a", detail: "x".repeat(SYNC_LOG_DETAIL_MAX) }, kv)).toBe(true);
    expect(readPendingReports(kv)).toHaveLength(1);
  });

  // 逃逸变异：只数拒收、不数挤出 → 计数少报。
  it("队列满挤出最旧条目也计入丢失", () => {
    const kv = fakeKV();
    for (let i = 0; i < PENDING_REPORTS_MAX + 2; i += 1) stashPendingReport({ action: "a", detail: String(i) }, kv);
    expect(takeDroppedReportCount(kv)).toBe(2);
  });

  // 逃逸变异：恢复「成功后整个清空」→ 途中新攒的被一起清掉。
  it("发送途中新攒的记录不随成功一起被清掉", async () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", detail: "旧" }, kv);
    await sendWithPending([{ action: "push" }], async () => {
      stashPendingReport({ action: "open_session", detail: "途中" }, kv);
    }, kv);
    expect(readPendingReports(kv)).toEqual([{ action: "open_session", detail: "途中" }]);
  });

  it("只删已发的：重复内容按次数删，多出来的那条留下", () => {
    const kv = fakeKV();
    const same = { action: "a", detail: "同" };
    stashPendingReport(same, kv);
    stashPendingReport(same, kv);
    removeSentReports([same], kv);
    expect(readPendingReports(kv)).toEqual([same]);
  });

  // 逃逸变异：去掉 in-flight 标记 → 第二个调用也带上同一份队列，服务端收到两份。
  it("并发：带队列的发送在途时，后来的调用只发自己的日志", async () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", detail: "旧" }, kv);
    let release: () => void = () => undefined;
    const firstSent: PendingReport[][] = [];
    const first = sendWithPending([{ action: "push" }], async (all) => {
      firstSent.push(all);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }, kv);
    const secondSent: PendingReport[][] = [];
    await sendWithPending([{ action: "pull" }], async (all) => {
      secondSent.push(all);
    }, kv);
    expect(secondSent).toEqual([[{ action: "pull" }]]);
    release();
    await first;
    expect(firstSent).toEqual([[{ action: "cold_start", detail: "旧" }, { action: "push" }]]);
    expect(readPendingReports(kv)).toEqual([]);
  });

  it("在途发送失败后标记复位，下一次照常带队列", async () => {
    const kv = fakeKV();
    stashPendingReport({ action: "cold_start", detail: "旧" }, kv);
    await expect(sendWithPending([{ action: "push" }], async () => {
      throw new Error("网络请求失败：");
    }, kv)).rejects.toThrow();
    let received: PendingReport[] = [];
    await sendWithPending([{ action: "push" }], async (all) => {
      received = all;
    }, kv);
    expect(received[0]).toEqual({ action: "cold_start", detail: "旧" });
  });

  // 逃逸变异：不按单批上限截断 → 服务端 400，整批（含本轮日志）都丢。
  it("队列 + 本轮日志超过单批上限：只带得下的部分随车，其余留着", async () => {
    const kv = fakeKV();
    for (let i = 0; i < PENDING_REPORTS_MAX; i += 1) stashPendingReport({ action: "q", detail: String(i) }, kv);
    const logs = Array.from({ length: SYNC_LOG_BATCH_MAX - 10 }, (_, i) => ({ action: "log", detail: String(i) }));
    let sentCount = 0;
    await sendWithPending(logs, async (all) => {
      sentCount = all.length;
    }, kv);
    expect(sentCount).toBe(SYNC_LOG_BATCH_MAX);
    expect(readPendingReports(kv).map((r) => r.detail)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 10)),
    );
  });
});
