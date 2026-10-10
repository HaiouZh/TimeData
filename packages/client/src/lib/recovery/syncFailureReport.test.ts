import { describe, expect, it } from "vitest";
import { ApiError } from "../api.js";
import type { PendingReport } from "./pendingReports.js";
import {
  SYNC_ERROR_REPORTS_PER_STREAK,
  classifySyncError,
  createSyncFailureTracker,
} from "./syncFailureReport.js";

function setup() {
  const stashed: PendingReport[] = [];
  let clock = 1_000;
  let seq = 0;
  const tracker = createSyncFailureTracker({
    now: () => clock,
    build: "b1",
    newId: () => `id${++seq}`,
    stash: (report) => {
      stashed.push(report);
    },
  });
  return {
    tracker,
    stashed,
    advance: (ms: number) => {
      clock += ms;
    },
    details: () => stashed.map((r) => ({ action: r.action, ...JSON.parse(r.detail ?? "{}") })),
  };
}

const failure = {
  reason: "resume",
  transport: "native-android",
  connection: "connecting",
  waitMs: 50,
  totalMs: 10_080,
  phases: { status: 10_075 },
};

describe("classifySyncError", () => {
  it("区分超时 / 连不上 / 服务端状态码 / 取消 / 其它", () => {
    expect(classifySyncError(new Error("网络请求超时（10000ms）：https://x/api/sync/status")).kind).toBe("timeout");
    expect(classifySyncError(new Error("网络请求失败：无法连接 https://x")).kind).toBe("network");
    expect(classifySyncError(new ApiError(503, "", "", null)).kind).toBe("http_503");
    expect(classifySyncError(new DOMException("Aborted", "AbortError")).kind).toBe("abort");
    expect(classifySyncError(new Error("同步账本异常")).kind).toBe("other");
  });

  it("带出底层 cause 的短摘要（原生异常名是判断 DNS / 连接 / 读超时的唯一线索）", () => {
    const cause = new Error("java.net.UnknownHostException: Unable to resolve host");
    const error = new Error("网络请求失败：无法连接 https://x", { cause });
    expect(classifySyncError(error).cause).toBe("java.net.UnknownHostException: Unable to resolve host");
  });

  it("cause 截断到 120 字", () => {
    const error = new Error("网络请求失败：x", { cause: new Error("e".repeat(300)) });
    expect(classifySyncError(error).cause).toHaveLength(120);
  });
});

describe("createSyncFailureTracker", () => {
  it("失败轮记一条 sync_error，带连败序号、通道、分段与错误类型", () => {
    const { tracker, details } = setup();
    tracker.recordFailure({ ...failure, error: new Error("网络请求超时（10000ms）：u") });
    expect(details()).toEqual([{
      action: "sync_error",
      id: "id1",
      build: "b1",
      streak: 1,
      reason: "resume",
      transport: "native-android",
      connection: "connecting",
      waitMs: 50,
      totalMs: 10_080,
      phases: { status: 10_075 },
      kind: "timeout",
      cause: null,
    }]);
  });

  it("同一段连败只记前几轮，防断网期间挤爆 30 条的待发送队列", () => {
    const { tracker, stashed } = setup();
    for (let i = 0; i < SYNC_ERROR_REPORTS_PER_STREAK + 4; i++) {
      tracker.recordFailure({ ...failure, error: new Error("网络请求失败：u") });
    }
    expect(stashed).toHaveLength(SYNC_ERROR_REPORTS_PER_STREAK);
  });

  it("连败后首次成功记一条 sync_recovered：总轮数与从首败起算的断档时长", () => {
    const { tracker, details, advance } = setup();
    for (let i = 0; i < SYNC_ERROR_REPORTS_PER_STREAK + 2; i++) {
      tracker.recordFailure({ ...failure, error: new Error("网络请求失败：u") });
      advance(10_000);
    }
    tracker.recordSuccess({ reason: "fallback", transport: "web", totalMs: 1_200 });
    expect(details().at(-1)).toEqual({
      action: "sync_recovered",
      id: `id${SYNC_ERROR_REPORTS_PER_STREAK + 1}`,
      build: "b1",
      streak: SYNC_ERROR_REPORTS_PER_STREAK + 2,
      outageMs: (SYNC_ERROR_REPORTS_PER_STREAK + 2) * 10_000,
      reason: "fallback",
      transport: "web",
      totalMs: 1_200,
    });
  });

  it("没失败过的成功不记；恢复后连败计数归零重来", () => {
    const { tracker, details } = setup();
    tracker.recordSuccess({ reason: "write", transport: "web", totalMs: 100 });
    expect(details()).toEqual([]);

    tracker.recordFailure({ ...failure, error: new Error("网络请求失败：u") });
    tracker.recordSuccess({ reason: "write", transport: "web", totalMs: 100 });
    tracker.recordFailure({ ...failure, error: new Error("网络请求失败：u") });
    expect(details().at(-1)).toMatchObject({ action: "sync_error", streak: 1 });
  });
});
