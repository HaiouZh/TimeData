// @vitest-environment jsdom
// 宽屏 master-detail 测试：需 mock useIsWideScreen（脏标记），有意留在 isolate:true 的 unit 桶，勿收编 fast-jsdom。
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// dbReset 必须先于任何触 db/index 的模块求值（fake-indexeddb 注册顺序），故 lib/tracks 放下面第二个 import 块。
import { db } from "../../test/dbReset.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";

vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));

import { addTrack, appendUserStep } from "../../lib/tracks.js";
import TrackDetailPage from "./TrackDetailPage.js";
import TracksListPage from "./TracksListPage.js";
import TracksShell from "./TracksShell.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  localStorage.clear();
  await db.open();
  await db.tracks.clear();
  await db.trackSteps.clear();
  await db.settings.clear();
  await db.syncLog.clear();
});
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function mountShell(initial: string) {
  mounted = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initial] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { element: createElement(TracksShell) },
          createElement(Route, { path: "/tracks", element: createElement(TracksListPage) }),
          createElement(Route, { path: "/tracks/:id", element: createElement(TrackDetailPage) }),
        ),
      ),
    ),
  );
  return mounted;
}

describe("TracksShell 宽屏 master-detail（调度台常驻）", () => {
  it("/tracks：左列调度台 + 右栏空态提示", async () => {
    await addTrack({ title: "写周报" });
    const { host } = await mountShell("/tracks");
    await waitFor(() => host.querySelector('[data-testid="dispatch-stats"]') !== null, "调度台统计带");
    expect(host.querySelector('[aria-label="轨道调度台"]')).not.toBeNull();
    expect(host.textContent).toContain("从左侧选一条轨道查看");
  });

  it("点状态卡：右栏出详情，调度台仍在、选中卡高亮", async () => {
    const track = await addTrack({ title: "写周报" });
    await appendUserStep({ trackId: track.id, content: "初具雏形，下一步优化", mode: "instant", tags: [] });
    const { host } = await mountShell("/tracks");
    await waitFor(() => host.querySelector(`a[href="/tracks/${track.id}"]`) !== null, "状态卡链接");
    await click(host.querySelector(`a[href="/tracks/${track.id}"]`));
    await waitFor(
      () => host.querySelector('[data-testid="current-frame-card"]') !== null,
      "当前帧卡（步骤数据落定）",
    );
    expect(host.querySelector("h1")?.textContent).toBe("写周报");
    expect(host.querySelector('[data-testid="current-frame-card"]')?.textContent).toContain("初具雏形");
    // 调度台仍在场，选中卡 accent 边框
    expect(host.querySelector('[aria-label="轨道调度台"]')).not.toBeNull();
    await waitFor(() => host.querySelector("article")?.className.includes("border-accent") === true, "选中卡高亮");
  });

  it("/tracks/:id 直达：左调度台 + 右详情", async () => {
    const track = await addTrack({ title: "写周报" });
    const { host } = await mountShell(`/tracks/${track.id}`);
    await waitFor(() => host.querySelector("h1") !== null, "详情标题");
    expect(host.querySelector("h1")?.textContent).toBe("写周报");
    await waitFor(() => host.querySelector('[aria-label="轨道调度台"]') !== null, "调度台");
  });
});
