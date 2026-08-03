// @vitest-environment jsdom
// dbReset（fake-indexeddb/auto）must import first：它得在任何东西碰 db/index.ts 的 `new Dexie(...)`
// 之前把 indexedDB 垫上。本文件因下面的 vi.mock 是 dirty marker，不在 unit-clean-jsdom 白名单里，
// 拿不到白名单 setup 的全局注册，必须自己排序 import。
import { db } from "../test/dbReset.js";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { addQuickNote, setQuickNotePinned } from "../lib/quickNotes.js";
import { renderDom, unmount } from "../test/domHarness.js";

const destructiveMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/haptics.ts", () => ({
  hapticToggle: vi.fn(),
  hapticDestructive: destructiveMock,
  hapticGrab: vi.fn(),
  hapticDrop: vi.fn(),
}));

import QuickNotesPage from "./QuickNotesPage.js";

async function act(callback: () => Promise<void> | void) {
  let result: Promise<void> | void;
  flushSync(() => {
    result = callback();
  });
  await result;
  flushSync(() => {});
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("missing clickable element");
  await act(async () => {
    element.click();
  });
  await flush();
}

function menuItemContaining(host: HTMLElement, text: string): HTMLButtonElement | null {
  const match = Array.from(host.querySelectorAll('button[role="menuitem"]')).find(
    (button) => button.textContent?.includes(text) ?? false,
  );
  return (match as HTMLButtonElement) ?? null;
}

function lastButtonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  const matches = Array.from(host.querySelectorAll("button")).filter((button) => button.textContent === text);
  return matches.at(-1) ?? null;
}

async function renderPage(initialEntry: string) {
  const { host, root } = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(BottomNavProvider, null, createElement(QuickNotesPage)),
    ),
  );
  await flush();
  return { host, root };
}

async function seedDay(count: number) {
  for (let i = 0; i < count; i += 1) {
    await addQuickNote(`第 ${i} 条`, {
      occurredAt: `2026-06-01T03:0${i}:00.000Z`,
      now: new Date("2026-06-01T04:00:00.000Z"),
    });
  }
}

beforeEach(async () => {
  await db.quickNotes.clear();
  await db.timeEntries.clear();
  await db.categories.clear();
  await db.settings.clear();
  await db.syncLog.clear();
  document.body.innerHTML = "";
  localStorage.clear();
  destructiveMock.mockReset();
});

/**
 * `handleDeleteDate` 的注释承诺了一条**顺序**约束：「没东西可删」的早退与「用户取消确认」都要在
 * 震动之前 return 掉，整批只在真的开始删的那一刻震一次。这条约束原先零覆盖——把 hapticDestructive()
 * 挪到确认框之前，全部既有用例照样绿（终审实测）。下面三条把三个位置都钉住。
 */
describe("整日清理的触感顺序", () => {
  it("用户在确认框点「取消」时不震", async () => {
    await seedDay(2);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");
    try {
      await click(host.querySelector('button[aria-label="更多操作"]'));
      await click(menuItemContaining(host, "清理"));
      // 确认框已经弹出来了，说明流程确实走到了「等用户拍板」这一步。
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除 6月1日 的速记");

      await click(lastButtonByText(host, "取消"));

      expect(destructiveMock).not.toHaveBeenCalled();
      await expect(db.quickNotes.count()).resolves.toBe(2);
    } finally {
      await unmount(root);
    }
  });

  it("确认删除时整批只震一次（不逐条震）", async () => {
    await seedDay(3);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");
    try {
      await click(host.querySelector('button[aria-label="更多操作"]'));
      await click(menuItemContaining(host, "清理"));
      await click(lastButtonByText(host, "删除"));

      expect(destructiveMock).toHaveBeenCalledTimes(1);
      await expect(db.quickNotes.count()).resolves.toBe(0);
    } finally {
      await unmount(root);
    }
  });

  it("这一天没有可删的（只剩置顶）时连确认框都不弹，更不震", async () => {
    const pinned = await addQuickNote("置顶", {
      occurredAt: "2026-06-01T03:00:00.000Z",
      now: new Date("2026-06-01T04:00:00.000Z"),
    });
    await setQuickNotePinned(pinned.id, true);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");
    try {
      await click(host.querySelector('button[aria-label="更多操作"]'));
      await click(menuItemContaining(host, "清理"));

      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(destructiveMock).not.toHaveBeenCalled();
    } finally {
      await unmount(root);
    }
  });
});
