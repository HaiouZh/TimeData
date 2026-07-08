// @vitest-environment jsdom
// 宽屏双栏测试：需 mock useIsWideScreen（脏标记），有意留在 isolate:true 的 unit 桶，勿收编 fast-jsdom。
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";

vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));

import TracksListPage from "./TracksListPage.js";

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

describe("TracksListPage 宽屏", () => {
  it("渲染双栏：列表 + 甘特 aside", async () => {
    mounted = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/tracks"] }, createElement(TracksListPage)),
    );
    const host = mounted.host;
    // lazy 甘特面板落地需要几轮微任务
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2000) {
      if (host.querySelector('[data-testid="tracks-gantt"]')) break;
      await flush();
    }
    expect(host.querySelector('[aria-label="并发甘特面板"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="tracks-gantt"]')).not.toBeNull();
    // 左栏列表仍在（新建轨道 composer）
    expect(host.querySelector('input[aria-label="新建轨道标题"]')).not.toBeNull();
  });
});
