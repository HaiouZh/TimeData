// @vitest-environment jsdom
// 宽屏 master-detail 测试：需 mock useIsWideScreen（脏标记），有意留在 isolate:true 的 unit 桶，勿收编 fast-jsdom。
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// dbReset 必须先于任何触 db/index 的模块求值（fake-indexeddb 注册顺序），故 lib/tracks 放下面第二个 import 块。
import { db } from "../../test/dbReset.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";

vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));

import { addTrack } from "../../lib/tracks.js";
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

describe("TracksShell 宽屏 master-detail", () => {
  it("/tracks：左列列表 + 右侧甘特常驻", async () => {
    await addTrack({ title: "写周报" });
    const { host } = await mountShell("/tracks");
    await waitFor(() => host.querySelector('[data-testid="tracks-gantt"]') !== null, "甘特面板");
    expect(host.querySelector('[aria-label="并发甘特面板"]')).not.toBeNull();
    expect(host.querySelector('input[aria-label="新建轨道标题"]')).not.toBeNull();
  });

  it("点现状栏轨道名：左列就地切详情，甘特不卸载", async () => {
    const track = await addTrack({ title: "写周报" });
    const { host } = await mountShell("/tracks");
    await waitFor(() => host.querySelector('button[title="写周报"]') !== null, "现状栏轨道名");
    await click(host.querySelector('button[title="写周报"]'));
    await waitFor(() => host.querySelector("h1") !== null, "详情标题");
    expect(host.querySelector("h1")?.textContent).toBe("写周报");
    // 列表 composer 让位给详情
    expect(host.querySelector('input[aria-label="新建轨道标题"]')).toBeNull();
    // 甘特仍在场（未整页跳转）
    expect(host.querySelector('[data-testid="tracks-gantt"]')).not.toBeNull();
    expect(host.textContent).toContain(track.title);
  });

  it("/tracks/:id 直达：宽屏同样是详情 + 甘特双栏", async () => {
    const track = await addTrack({ title: "写周报" });
    const { host } = await mountShell(`/tracks/${track.id}`);
    await waitFor(() => host.querySelector("h1") !== null, "详情标题");
    expect(host.querySelector("h1")?.textContent).toBe("写周报");
    await waitFor(() => host.querySelector('[data-testid="tracks-gantt"]') !== null, "甘特面板");
  });
});
