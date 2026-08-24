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
import { addQuickNote } from "../lib/quickNotes.js";
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
 * 删除动作的**顺序**约束：用户取消确认时不能震，只有真的开始删的那一刻才震一次。
 *
 * 这条约束原先挂在整日清理（`handleDeleteDate`）上，那个功能已随速记页的按天菜单一起退役
 * （按日期范围导出 / 删除在 设置 → 数据 里）。约束本身没走——速记页仍有一处 `hapticDestructive()`
 * 在单条删除里，位置错了照样会在用户按「取消」时震，所以覆盖跟着迁到这里。
 *
 * 顺带记一笔已知缺口：多选批量删除（`handleBatchDelete`）**不震**。按 design-language/invariants
 * 第 13 条它本该震（且整批只震一次），但那是独立于本次改动的既有行为，没在这里顺手改。
 */
describe("删除的触感顺序", () => {
  async function openBubbleMenu(host: HTMLElement, label: string) {
    const bubble = Array.from(host.querySelectorAll('[role="button"]')).find(
      (element) => element.textContent?.includes(label) ?? false,
    );
    if (!(bubble instanceof HTMLElement)) throw new Error(`missing bubble ${label}`);
    await act(async () => {
      bubble.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    });
    await flush();
  }

  it("用户在确认框点「取消」时不震", async () => {
    await seedDay(1);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");
    try {
      await openBubbleMenu(host, "第 0 条");
      await click(menuItemContaining(host, "删除"));
      // 确认框已经弹出来了，说明流程确实走到了「等用户拍板」这一步。
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除这条速记");

      await click(lastButtonByText(host, "取消"));

      expect(destructiveMock).not.toHaveBeenCalled();
      await expect(db.quickNotes.count()).resolves.toBe(1);
    } finally {
      await unmount(root);
    }
  });

  it("确认删除时震一次", async () => {
    await seedDay(1);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");
    try {
      await openBubbleMenu(host, "第 0 条");
      await click(menuItemContaining(host, "删除"));
      await click(lastButtonByText(host, "删除"));

      expect(destructiveMock).toHaveBeenCalledTimes(1);
      await expect(db.quickNotes.count()).resolves.toBe(0);
    } finally {
      await unmount(root);
    }
  });
});
