// @vitest-environment jsdom
// resetDb（dbReset.js）must import first：它在任何东西碰 db/index.ts 的 `new Dexie(...)` 之前
// 拉起 fake-indexeddb/auto。本文件因下面的 vi.mock 是 dirty marker，不在 unit-clean-jsdom 白名单里，
// 拿不到 setup 文件的全局注册，必须自己排序 import。
import { resetDb } from "../test/dbReset.js";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { addTask } from "../lib/tasks.js";
import { click, renderDom, unmount } from "../test/domHarness.js";

const toggleMock = vi.hoisted(() => vi.fn());
const destructiveMock = vi.hoisted(() => vi.fn());
const grabMock = vi.hoisted(() => vi.fn());
const dropMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/haptics.ts", () => ({
  hapticToggle: toggleMock,
  hapticDestructive: destructiveMock,
  hapticGrab: grabMock,
  hapticDrop: dropMock,
}));

import { TodoPage } from "./TodoPage.js";

beforeEach(async () => {
  localStorage.clear();
  toggleMock.mockReset();
  destructiveMock.mockReset();
  grabMock.mockReset();
  dropMock.mockReset();
  await resetDb();
});

async function renderPage() {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/todo"] },
      createElement(BottomNavProvider, null, createElement(SyncProvider, null, createElement(TodoPage))),
    ),
  );
}

// fake-indexeddb 的事务提交要真实让出一次宏任务（0ms，非等待时长）；
// 照 TodoPage.test.tsx / TodoPage.keyboard.test.tsx 同名 settle 的既有写法。
async function settle(): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForCheckbox(host: HTMLElement, label: string): Promise<HTMLInputElement> {
  for (let i = 0; i < 20; i += 1) {
    const el = host.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${label}"]`);
    if (el) return el;
    await settle();
  }
  throw new Error(`复选框未出现：${label}`);
}

describe("待办触感接线", () => {
  it("勾选任务调一次最轻档触感", async () => {
    await addTask({ title: "触感用例任务", toInbox: true });
    const { host, root } = await renderPage();

    const box = await waitForCheckbox(host, "完成 触感用例任务");
    await click(box);
    await settle();

    expect(toggleMock).toHaveBeenCalledTimes(1);
    expect(destructiveMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("仅渲染页面不触发任何触感", async () => {
    await addTask({ title: "触感用例任务", toInbox: true });
    const { host, root } = await renderPage();
    await waitForCheckbox(host, "完成 触感用例任务");

    expect(toggleMock).not.toHaveBeenCalled();
    expect(grabMock).not.toHaveBeenCalled();
    expect(dropMock).not.toHaveBeenCalled();
    await unmount(root);
  });
});
