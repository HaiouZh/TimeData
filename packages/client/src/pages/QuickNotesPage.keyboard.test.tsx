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
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { renderDom, unmount } from "../test/domHarness.js";

// QuickNotes 三处底部避让合成接线（contentBottomInsetPx/floatBottomInsetPx/composerBarBottomPx，
// 见 QuickNotesPage.tsx ~186-195）此前无任何测试直接钉：mock useKeyboardHeight，断言键盘高确实被
// 计入三处消费点，keyboard=0 时落回合成前口径（安全不变量）。keyboard hook 自身行为已由
// useKeyboardHeight.test.tsx 钉过，这里只钉 QuickNotesPage 内的接线。
const keyboardHeightMock = vi.hoisted(() => vi.fn(() => 0));
// 「键盘在不在场」独立信号：安卓壳层让位后 height 恒 0，inputInteractionActive 的在场判断走它。
const keyboardVisibleMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../hooks/useKeyboardHeight.ts", () => ({
  useKeyboardHeight: keyboardHeightMock,
  useKeyboardVisible: keyboardVisibleMock,
}));

import QuickNotesPage from "./QuickNotesPage.js";

// jsdom 下 composer 表单量不到高度（getBoundingClientRect 恒 0），QuickNotesPage.tsx 的测量 effect
// 遇 height<=0 早退，composerInsetPx 停在这个初始默认值——与 QuickNotesPage.test.tsx「reserves bottom
// space from the measured composer height」用例的退化路径一致，非本文件杜撰的数字。
const DEFAULT_COMPOSER_INSET_PX = 128;

beforeEach(async () => {
  localStorage.clear();
  keyboardHeightMock.mockReset();
  keyboardHeightMock.mockReturnValue(0);
  keyboardVisibleMock.mockReset();
  keyboardVisibleMock.mockReturnValue(false);
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

function contentSection(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[aria-label="速记列表"]');
}

function composerForm(host: HTMLElement): HTMLFormElement | null {
  return host.querySelector('form[aria-label="速记输入区"]');
}

describe("QuickNotesPage 底部避让接线（键盘高并入合成）", () => {
  it("键盘弹起时，内容区 paddingBottom 与 composer 输入条 bottom 都计入键盘高", async () => {
    keyboardHeightMock.mockReturnValue(300);
    keyboardVisibleMock.mockReturnValue(true);
    const { host, root } = await renderPage();

    const list = contentSection(host);
    expect(list).toBeInstanceOf(HTMLElement);
    // contentBottomInsetPx = barHeightPx（composerInsetPx，默认 128）+ navOffsetPx（内容区固定传 0，
    // 与 navHidden 时序无关）+ 键盘高。
    expect((list as HTMLElement).style.paddingBottom).toBe(
      `calc(${DEFAULT_COMPOSER_INSET_PX + 300}px + var(--safe-bottom))`,
    );

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // composerBarBottomPx：键盘高>0 时 inputInteractionActive 恒真，navHidden effect 结算后
    // navOffsetPx 归零，故 = 0（barHeightPx）+ 0（navOffsetPx）+ 300（键盘高）= 300。
    // 载体迁移（键盘运动波）：抬升走 transform 吃过渡，bottom 只装安全区。
    expect(form?.style.transform).toBe("translateY(-300px)");
    expect(form?.style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });

  it("键盘收起（keyboard=0）时，内容区与 composer 输入条都回落到合成前口径", async () => {
    const { host, root } = await renderPage();

    const list = contentSection(host);
    expect((list as HTMLElement).style.paddingBottom).toBe(`calc(${DEFAULT_COMPOSER_INSET_PX}px + var(--safe-bottom))`);

    const form = composerForm(host);
    // navHidden 未被触发，保持初始 false；窄屏（jsdom 默认 matchMedia 判宽屏为假）下
    // navOffsetPx = BOTTOM_NAV_HEIGHT_PX，composerBarBottomPx = 0 + BOTTOM_NAV_HEIGHT_PX + 0。
    expect(form?.style.transform).toBe(`translateY(-${BOTTOM_NAV_HEIGHT_PX}px)`);
    expect(form?.style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });

  // 安卓壳层让位（adjustResize + ime inset）后：webview 变矮、height 恒 0，但键盘在场。
  // inputInteractionActive 的在场判断若还看 height>0，nav 不收——缩短的视口里输入条与键盘之间
  // 杵着一条 tab 行。在场判断走 useKeyboardVisible（插件事件驱动，壳让位后事件照发）。
  it("安卓壳已让位（height=0 但键盘在场）：nav 收起，composer bottom 归 0 贴 webview 底", async () => {
    keyboardHeightMock.mockReturnValue(0);
    keyboardVisibleMock.mockReturnValue(true);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // inputInteractionActive 恒真 → navHidden 结算 → navOffsetPx 0；height=0 无 JS 抬升叠加。
    expect(form?.style.transform).toBe("translateY(0px)");
    expect(form?.style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });

  it("键盘弹起时，贴 composer 上沿的状态浮层 bottom 也计入键盘高", async () => {
    // 挂载时若本地存着未发出的草稿会弹一条状态提示（见 QuickNotesPage.test.tsx 同款用例），
    // 借它让 floatBottomInsetPx 消费点在 DOM 里现身，不用另造专属 hook。
    localStorage.setItem(STORAGE_KEYS.quickNoteComposerDraft, "写了一半");
    keyboardHeightMock.mockReturnValue(300);
    keyboardVisibleMock.mockReturnValue(true);
    const { host, root } = await renderPage();

    // 按 data-tone 取，不按标签取：状态浮层是 StatusBanner（渲染 div），标签会随组件走，
    // data-tone 是它对外的稳定锚点。顺带把「这条浮层确实是 info 档状态条」也断言进来。
    const status = Array.from(host.querySelectorAll<HTMLElement>('[data-tone="info"]')).find(
      (el) => el.textContent === "已恢复未发出的草稿",
    );
    expect(status).toBeInstanceOf(HTMLElement);
    // floatBottomInsetPx = barHeightPx（128）+ navOffsetPx（结算后归零）+ 键盘高（300）。
    expect((status as HTMLElement).style.bottom).toBe(`calc(${DEFAULT_COMPOSER_INSET_PX + 300}px + var(--safe-bottom))`);

    await unmount(root);
  });
});
