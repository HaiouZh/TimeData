// @vitest-environment jsdom
// resetDb（dbReset.js）must import first: it pulls in fake-indexeddb/auto before anything else
// touches db/index.ts's `new Dexie(...)` (see dbReset.ts's own comment) — this file isn't in the
// unit-clean-jsdom allowlist (vi.mock below is a dirty marker), so it doesn't get that setup file's
// global fake-indexeddb registration for free and must order its own imports to get it.
import { resetDb } from "../test/dbReset.js";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOTTOM_NAV_HEIGHT_PX, BottomNavProvider } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { renderDom, unmount } from "../test/domHarness.js";

// Task 3 fix round 1：TodoComposer/TodoSelectionBar 的 bottomOffsetPx 此前只喂 navOffsetPx，
// 键盘弹起时（resize:none 下 webview 不 reflow）输入条会被键盘盖住。mock useKeyboardHeight
// 而不是真的模拟 @capacitor/keyboard 事件——这条钉的是 TodoPage 内 navOffsetPx 守卫 +
// composerBarBottomPx 合成的接线是否正确，keyboard hook 自身的行为已由 useKeyboardHeight.test.tsx 钉过。
const keyboardHeightMock = vi.hoisted(() => vi.fn(() => 0));
vi.mock("../hooks/useKeyboardHeight.ts", () => ({
  useKeyboardHeight: keyboardHeightMock,
}));

import { TodoPage } from "./TodoPage.js";

beforeEach(async () => {
  localStorage.clear();
  keyboardHeightMock.mockReset();
  keyboardHeightMock.mockReturnValue(0);
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

// TodoComposer 渲染的固定输入条是本页默认态下唯一的 <form>（TodoProjectSection 的重命名 form
// 只在 renaming 态才挂载，初始不在 DOM 里），可以直接按标签选取。
function composerForm(host: HTMLElement): HTMLFormElement | null {
  return host.querySelector("form");
}

describe("TodoPage 底部输入条键盘避让（fix round 1）", () => {
  it("键盘弹起时，composer 输入条 bottom 稳贴键盘上沿——nav 让位，不与 navOffsetPx 叠加", async () => {
    keyboardHeightMock.mockReturnValue(300);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // navOffsetPx 被键盘高守卫归零，composerBarBottomPx = 0 + 0 + 300 = 300。
    expect(form?.style.bottom).toBe("calc(300px + var(--safe-bottom))");

    await unmount(root);
  });

  it("键盘收起（keyboardHeightPx=0）时，输入条 bottom 与本轮前完全一致（= navOffsetPx）", async () => {
    keyboardHeightMock.mockReturnValue(0);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    expect(form?.style.bottom).toBe(`calc(${BOTTOM_NAV_HEIGHT_PX}px + var(--safe-bottom))`);

    await unmount(root);
  });
});
