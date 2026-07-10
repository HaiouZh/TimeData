// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
