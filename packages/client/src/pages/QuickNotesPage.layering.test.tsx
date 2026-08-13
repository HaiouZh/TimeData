// @vitest-environment jsdom
// resetDb（dbReset.js）must import first：理由同 QuickNotesPage.keyboard.test.tsx 的文件头注释。
import { resetDb } from "../test/dbReset.js";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { Z } from "../lib/zLayers.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { renderDom, unmount } from "../test/domHarness.js";

import QuickNotesPage from "./QuickNotesPage.js";

beforeEach(async () => {
  localStorage.clear();
  await resetDb();
});

async function renderPage() {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/quick-notes"] },
      createElement(BottomNavProvider, null, createElement(QuickNotesPage)),
    ),
  );
}

// 速记页底部这几个 fixed 元素此前一个 z-index 都没写，而列表里的日期气泡是 z-10、页面顶栏是 z-20：
// 同一层叠上下文里「有 z-index 的」永远压过「z-index: auto 的」，与 DOM 顺序无关——只要几何上撞上，
// 气泡就画在输入条上面（真机上表现为「日期气泡钻进输入框」）。待办页的同类固定条早已显式带
// Z.backdrop，这里对齐。jsdom 不解析 Tailwind 的 z-10/z-20，故只能钉「不是 auto 且落在阶梯上」。
describe("QuickNotesPage 底部固定层的层级", () => {
  it("输入条带显式 z 层级（Z.backdrop），不靠 DOM 顺序压日期气泡", async () => {
    const { host, root } = await renderPage();

    const form = host.querySelector<HTMLFormElement>('form[aria-label="速记输入区"]');
    expect(form).not.toBeNull();
    expect(form?.style.zIndex).toBe(String(Z.backdrop));

    await unmount(root);
  });

  it("贴输入条上沿的状态浮层与输入条同层", async () => {
    // 借「恢复未发出的草稿」这条提示让 floatBottomInsetPx 那组浮层现身（同 keyboard 用例的做法）。
    // 另两个消费点（「最新」按钮、错误条）触发条件依赖滚动位置与写入失败，本用例构造不出，
    // 但它们与本条共用同一份定位/层级写法，改动时一并核对。
    localStorage.setItem(STORAGE_KEYS.quickNoteComposerDraft, "写了一半");
    const { host, root } = await renderPage();

    const status = Array.from(host.querySelectorAll<HTMLElement>('[data-tone="info"]')).find(
      (el) => el.textContent === "已恢复未发出的草稿",
    );
    expect(status).toBeInstanceOf(HTMLElement);
    expect(status?.style.zIndex).toBe(String(Z.backdrop));

    await unmount(root);
  });
});
