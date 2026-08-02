// @vitest-environment jsdom
// resetDb（dbReset.js）must import first: it pulls in fake-indexeddb/auto before anything else
// touches db/index.ts's `new Dexie(...)` (see dbReset.ts's own comment) — this file isn't in the
// unit-clean-jsdom allowlist (vi.mock below is a dirty marker), so it doesn't get that setup file's
// global fake-indexeddb registration for free and must order its own imports to get it.
import { resetDb } from "../test/dbReset.js";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOTTOM_NAV_HEIGHT_PX, BottomNavProvider } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { addTask } from "../lib/tasks.js";
import { renderDom, unmount } from "../test/domHarness.js";

// Task 3 fix round 1：TodoComposer/TodoSelectionBar 的 bottomOffsetPx 此前只喂 navOffsetPx，
// 键盘弹起时（resize:none 下 webview 不 reflow）输入条会被键盘盖住。mock useKeyboardHeight
// 而不是真的模拟 @capacitor/keyboard 事件——这条钉的是 TodoPage 内 navOffsetPx 守卫 +
// fixedBarBottomPx 合成的接线是否正确，keyboard hook 自身的行为已由 useKeyboardHeight.test.tsx 钉过。
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

// fake-indexeddb 的事务提交要真实让出一次宏任务；下面几个多选态用例落库/轮询都靠它推进，
// 照 TodoPage.test.tsx 同名 `settle` 的既有写法——不是新发明的等待方式。
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (host.textContent?.includes(text)) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${text}`);
}

/** 进入多选：点收件箱标题右侧的「圈成项目」（与 TodoPage.test.tsx 同名助手同写法）。 */
async function enterSelection(host: HTMLElement): Promise<void> {
  const entry = host.querySelector('[data-section="inbox"] [aria-label="圈成项目"]') as HTMLButtonElement;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}

function selectionBar(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-testid="todo-selection-bar"]');
}

describe("TodoPage 底部输入条键盘避让（fix round 1）", () => {
  it("键盘弹起时，composer 输入条 bottom 稳贴键盘上沿——nav 让位，不与 navOffsetPx 叠加", async () => {
    keyboardHeightMock.mockReturnValue(300);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // navOffsetPx 被键盘高守卫归零，fixedBarBottomPx = 0 + 0 + 300 = 300。
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

  it("composer 输入条 bottom 不重复叠自身高度（fixedBarBottomPx 用 barHeightPx:0 钉）", async () => {
    // 强制量出一个非零 composer 高度（jsdom 默认 getBoundingClientRect 恒 0，量不出真实高度，
    // 那样就算 fixedBarBottomPx 误用了 barHeightPx: composerHeightPx 也测不出来——composerHeightPx
    // 同样是 0，两种写法在默认路径下无法区分，是假闸）。
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLFormElement) {
        return {
          x: 0,
          y: 0,
          width: 390,
          height: 148,
          top: 0,
          right: 390,
          bottom: 148,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    keyboardHeightMock.mockReturnValue(300);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // 若 fixedBarBottomPx 误把 composerHeightPx（这里量出 148）当 barHeightPx 传，结果会是
    // calc(448px + ...)；正确口径下 composer 自身不叠自身高度，仍是 calc(300px + ...)。
    expect(form?.style.bottom).toBe("calc(300px + var(--safe-bottom))");

    await unmount(root);
  });
});

describe("TodoPage 多选态操作栏键盘避让", () => {
  it("多选态下键盘弹起，SelectionBar bottom 计入键盘高", async () => {
    await addTask({ title: "买灯", toInbox: true });
    keyboardHeightMock.mockReturnValue(300);
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");

    await enterSelection(host);
    const bar = selectionBar(host);
    expect(bar).not.toBeNull();
    // 多选态项目名输入框会弹键盘（B2 修正的那条注释）：fixedBarBottomPx 走同一合成，
    // navOffsetPx 被键盘高守卫归零，= 0（barHeightPx）+ 0（navOffsetPx）+ 300（键盘高）。
    expect((bar as HTMLElement).style.bottom).toBe("calc(300px + var(--safe-bottom))");

    await unmount(root);
  });

  it("多选态下键盘收起（keyboard=0），SelectionBar bottom 与本轮前一致（= navOffsetPx）", async () => {
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");

    await enterSelection(host);
    const bar = selectionBar(host);
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.bottom).toBe(`calc(${BOTTOM_NAV_HEIGHT_PX}px + var(--safe-bottom))`);

    await unmount(root);
  });
});
