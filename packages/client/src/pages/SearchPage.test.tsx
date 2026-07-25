// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../test/dbReset.js";
import { cleanupRoots, renderDom, unmount } from "../test/domHarness.js";
import { db } from "../db/index.ts";
import SearchPage from "./SearchPage.js";

async function seed(): Promise<void> {
  await db.categories.bulkPut([
    {
      id: "cat-sleep", name: "睡眠", parentId: null, color: "#3355aa", icon: null, sortOrder: 0,
      isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "cat-sleep-nap", name: "小睡", parentId: "cat-sleep", color: "#3355aa", icon: null, sortOrder: 0,
      isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  await db.timeEntries.bulkPut([
    {
      id: "e1", categoryId: "cat-sleep-nap",
      startTime: new Date("2026-02-14T16:51:00+08:00").toISOString(),
      endTime: new Date("2026-02-14T17:22:00+08:00").toISOString(),
      note: null, createdAt: "2026-02-14T00:00:00.000Z", updatedAt: "2026-02-14T00:00:00.000Z",
    },
  ]);
}

beforeEach(async () => {
  // fake-indexeddb 用真实 setImmediate 驱动事务完成回调；若把它也伪造掉，resetDb/useLiveQuery
  // 的底层事务永远等不到回调，beforeEach 会直接卡到 hook 超时。这里只伪造 Date/setTimeout 系列。
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-02-14T12:00:00+08:00"));
  await resetDb();
  await seed();
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupRoots();
});

describe("SearchPage", () => {
  it("默认年档列出当年记录并给出四项汇总", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/search"] }, createElement(SearchPage)),
    );
    await vi.advanceTimersByTimeAsync(300);

    expect(host.textContent).toContain("搜索");
    expect(host.textContent).toContain("睡眠 · 小睡");
    expect(host.textContent).toContain("31分钟");
    expect(host.textContent).toContain("天数");
    expect(host.textContent).toContain("次数");
    await unmount(root);
  });

  it("URL 带的筛选状态被还原", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/search?range=year&anchor=2020-01-01"] },
        createElement(SearchPage),
      ),
    );
    await vi.advanceTimersByTimeAsync(300);

    expect(host.textContent).toContain("2020");
    expect(host.textContent).toContain("这个范围里没有匹配的记录");
    await unmount(root);
  });
});
