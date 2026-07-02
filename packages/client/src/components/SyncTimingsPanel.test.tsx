// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSyncTiming } from "../sync/phaseTimings.js";
import { renderDom, unmount } from "../test/domHarness.js";
import SyncTimingsPanel from "./SyncTimingsPanel.js";

describe("SyncTimingsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders nothing when there is no recorded timing", async () => {
    const { host, root } = await renderDom(createElement(SyncTimingsPanel));

    expect(host.textContent).toBe("");

    await unmount(root);
  });

  it("shows the latest phase breakdown and p50/p95 across two entries", async () => {
    recordSyncTiming({
      at: "2026-07-01T00:00:00.000Z",
      outcome: "pushed",
      totalMs: 400,
      phases: { status: 30, push: 200, pull: 100 },
    });
    recordSyncTiming({
      at: "2026-07-02T00:00:00.000Z",
      outcome: "pushed",
      totalMs: 800,
      phases: { status: 40, push: 500, pull: 180 },
    });

    const { host, root } = await renderDom(createElement(SyncTimingsPanel));

    // 最近一次（第二条，最新在前）总耗时 + 各阶段 ms
    expect(host.textContent).toContain("800");
    expect(host.textContent).toContain("状态 40");
    expect(host.textContent).toContain("推送 500");
    expect(host.textContent).toContain("拉取 180");

    // 近 2 次 总耗时 p50/p95
    expect(host.textContent).toContain("近2次");
    expect(host.textContent).toContain("p50");
    expect(host.textContent).toContain("p95");

    await unmount(root);
  });

  it("silently ignores legacy health/backup/report phase keys from old localStorage entries", async () => {
    recordSyncTiming({
      at: "2026-07-01T00:00:00.000Z",
      outcome: "pushed",
      // biome-ignore lint/suspicious/noExplicitAny: 模拟历史环形缓冲里已退役的阶段名
      phases: { health: 50, status: 30, push: 200, pull: 100, report: 5 } as any,
      totalMs: 400,
    });

    const { host, root } = await renderDom(createElement(SyncTimingsPanel));

    expect(host.textContent).not.toContain("探活");
    expect(host.textContent).not.toContain("上报");
    expect(host.textContent).toContain("状态 30");
    expect(host.textContent).toContain("推送 200");
    expect(host.textContent).toContain("拉取 100");

    await unmount(root);
  });

  it("shows waitMs/reason/connection when present on the latest entry", async () => {
    recordSyncTiming({
      at: "2026-07-01T00:00:00.000Z",
      outcome: "pushed",
      totalMs: 400,
      phases: { status: 30, push: 200, pull: 100 },
      waitMs: 120,
      reason: "manual",
      connection: "connected",
    });

    const { host, root } = await renderDom(createElement(SyncTimingsPanel));

    expect(host.textContent).toContain("等待 120ms");
    expect(host.textContent).toContain("manual");
    expect(host.textContent).toContain("connected");

    await unmount(root);
  });

  it("does not show wait/reason/connection column when absent", async () => {
    recordSyncTiming({
      at: "2026-07-01T00:00:00.000Z",
      outcome: "pushed",
      totalMs: 400,
      phases: { status: 30, push: 200, pull: 100 },
    });

    const { host, root } = await renderDom(createElement(SyncTimingsPanel));

    expect(host.textContent).not.toContain("等待");

    await unmount(root);
  });
});
