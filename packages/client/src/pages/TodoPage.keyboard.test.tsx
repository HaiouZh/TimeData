// @vitest-environment jsdom
// resetDb（dbReset.js）must import first: it pulls in fake-indexeddb/auto before anything else
// touches db/index.ts's `new Dexie(...)` (see dbReset.ts's own comment) — this file isn't in the
// unit-clean-jsdom allowlist (vi.mock below is a dirty marker), so it doesn't get that setup file's
// global fake-indexeddb registration for free and must order its own imports to get it.
import { resetDb } from "../test/dbReset.js";
import { act, createElement, useEffect } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOTTOM_NAV_HEIGHT_PX, BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { addTask } from "../lib/tasks.js";
import { renderDom, unmount } from "../test/domHarness.js";

// Task 3 fix round 1：TodoComposer/TodoSelectionBar 的 bottomOffsetPx 此前只喂 navOffsetPx，
// 键盘弹起时（resize:none 下 webview 不 reflow）输入条会被键盘盖住。mock useKeyboardHeight
// 而不是真的模拟 @capacitor/keyboard 事件——这条钉的是 TodoPage 内 navOffsetPx 守卫 +
// fixedBarBottomPx 合成的接线是否正确，keyboard hook 自身的行为已由 useKeyboardHeight.test.tsx 钉过。
const keyboardHeightMock = vi.hoisted(() => vi.fn(() => 0));
// 「键盘在不在场」独立信号：安卓壳层让位后 height 恒 0，收底栏/守 composer 的在场判断走它。
const keyboardVisibleMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../hooks/useKeyboardHeight.ts", () => ({
  useKeyboardHeight: keyboardHeightMock,
  useKeyboardVisible: keyboardVisibleMock,
}));

import { TodoPage } from "./TodoPage.js";

beforeEach(async () => {
  localStorage.clear();
  keyboardHeightMock.mockReset();
  keyboardHeightMock.mockReturnValue(0);
  keyboardVisibleMock.mockReset();
  keyboardVisibleMock.mockReturnValue(false);
  await resetDb();
});

/** iOS（壳不让位）：键盘在场且仍挡着 height px。height > 0 时在场恒真，成对设置。 */
function mockKeyboardShown(heightPx: number) {
  keyboardHeightMock.mockReturnValue(heightPx);
  keyboardVisibleMock.mockReturnValue(true);
}

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

/**
 * 直接读 BottomNavContext 的 hidden，比渲染整条 MobileBottomNav 轻（后者还要 TrackAttentionProvider）。
 * 钉的是「TodoPage 有没有把底栏实体收起来」这个副作用本身，而非避让量 navOffsetPx。
 */
function NavHiddenProbe() {
  const { hidden } = useBottomNav();
  return createElement("span", { "data-testid": "nav-hidden" }, String(hidden));
}

/** 模拟进场前底栏已被滚动驱动藏起（照 TodoPage.test.tsx 的 HideBottomNavOnMount 同款写法）。 */
function HideNavOnMount() {
  const { setHidden } = useBottomNav();
  useEffect(() => {
    setHidden(true);
  }, [setHidden]);
  return null;
}

async function renderPageWithNavProbe({ hideNavOnMount = false } = {}) {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/todo"] },
      createElement(
        BottomNavProvider,
        null,
        createElement(NavHiddenProbe),
        hideNavOnMount ? createElement(HideNavOnMount) : null,
        createElement(SyncProvider, null, createElement(TodoPage)),
      ),
    ),
  );
}

function navHidden(host: HTMLElement): string | undefined {
  return host.querySelector('[data-testid="nav-hidden"]')?.textContent ?? undefined;
}

describe("TodoPage 键盘弹起时收起底部导航栏", () => {
  // 此前只把 navOffsetPx 守卫成 0（避让量不再计入 nav），但 nav 实体从未被收起——resize:none 下
  // webview 不 reflow，那 49px 就实打实杵在输入条与键盘之间，用户看到的就是「隔着一条 tab 行」。
  // 速记页早有这条（QuickNotesPage 的 inputInteractionActive effect），待办页漏了。
  it("键盘弹起时底栏被收起，不再杵在输入条与键盘之间", async () => {
    mockKeyboardShown(300);
    const { host, root } = await renderPageWithNavProbe();

    expect(navHidden(host)).toBe("true");

    await unmount(root);
  });

  // 反向守卫：别把 effect 写成无条件收起——键盘收起后底栏必须交还给滚动驱动（App 层
  // useHideBottomNavOnScroll），否则待办页的底栏会一直消失。
  it("键盘收起时不主动收起底栏，维持滚动驱动的原行为", async () => {
    keyboardHeightMock.mockReturnValue(0);
    const { host, root } = await renderPageWithNavProbe();

    expect(navHidden(host)).toBe("false");

    await unmount(root);
  });

  // 钉 navHiddenByKeyboardRef：写成无条件 setNavHidden(keyboardHeightPx > 0) 时，挂载那帧键盘恒为 0，
  // 会把滚动驱动刚藏好的底栏瞬间弹回来（TodoPage.test.tsx 的 hideBottomNav 用例会一起变红）。
  it("进场时底栏已被滚动藏起、键盘未弹过，不被本页 effect 冲回显示", async () => {
    keyboardHeightMock.mockReturnValue(0);
    const { host, root } = await renderPageWithNavProbe({ hideNavOnMount: true });

    expect(navHidden(host)).toBe("true");

    await unmount(root);
  });
});

describe("TodoPage 底部输入条键盘避让（fix round 1；抬升载体自 bottom 迁至 transform）", () => {
  // 载体迁移（键盘运动波）：bottom 只装安全区、恒为 calc(0px + var(--safe-bottom))，动态抬升
  // （navOffset / 键盘高）走 transform: translateY(-抬升量)——吃 transition-transform 的过渡，
  // 位移变滑动（合成器线程），等效总位移与迁移前逐值相等。
  it("键盘弹起时，composer 抬升 = 键盘高稳贴键盘上沿——nav 让位，不与 navOffsetPx 叠加", async () => {
    mockKeyboardShown(300);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // navOffsetPx 被键盘高守卫归零，fixedBarBottomPx = 0 + 0 + 300 = 300。
    expect(form?.style.transform).toBe("translateY(-300px)");
    expect(form?.style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });

  it("键盘收起（keyboardHeightPx=0）时，输入条抬升与本轮前完全一致（= navOffsetPx）", async () => {
    keyboardHeightMock.mockReturnValue(0);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    expect(form?.style.transform).toBe(`translateY(-${BOTTOM_NAV_HEIGHT_PX}px)`);
    expect(form?.style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });

  // 用户实测（安卓/iOS 都是）：待办页唤起输入法后整条输入框消失。根因不在 bottom——键盘弹起
  // 触发本页「收起底栏实体」的 effect（setNavHidden(true)，上一个 describe 钉的正确行为），而
  // composerHiddenByScroll 直接复用了 navHidden，把「键盘引起的收 nav」误判成「滚动收起」，
  // 输入条自己 translateY(100%) 滑进键盘后面。上面只断言 bottom 的用例拦不住它（bottom 正确、
  // transform 把人藏了，测试照样绿），这条专钉 transform。
  it("键盘弹起时，composer 不得随 navHidden 联动 translateY(100%) 自藏", async () => {
    mockKeyboardShown(300);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // 载体迁移后正常态是抬升值而非 translateY(0)：钉「不是 100% 自藏」+「抬升在位」。
    expect(form?.style.transform).toBe("translateY(-300px)");

    await unmount(root);
  });

  // 安卓壳层让位（adjustResize + ime inset）后：webview 变矮、useKeyboardHeight 恒 0（JS 无需
  // 再让位），但键盘确实在场。在场判断若还看 height，三件事一起坏：底栏不收（杵在输入条与
  // 键盘之间一条 tab 行）、composer 被 navHidden 联动误藏、守卫全部失灵。在场判断必须走
  // useKeyboardVisible（插件事件驱动，壳让位后事件照发）。
  it("安卓壳已让位（height=0 但键盘在场）：底栏收起、composer 不自藏、bottom 不再叠避让", async () => {
    keyboardHeightMock.mockReturnValue(0);
    keyboardVisibleMock.mockReturnValue(true);
    const { host, root } = await renderPageWithNavProbe();

    // 底栏收起（否则 webview 缩短后它杵在键盘正上方）。
    expect(navHidden(host)).toBe("true");

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // composer 不被 navHidden 联动藏掉；壳已让位：JS 不叠加抬升（height=0、nav 已收 → navOffset 0），
    // 抬升 0、bottom 恒贴 webview 底。
    expect(form?.style.transform).toBe("translateY(0px)");
    expect(form?.style.bottom).toBe("calc(0px + var(--safe-bottom))");

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

    mockKeyboardShown(300);
    const { host, root } = await renderPage();

    const form = composerForm(host);
    expect(form).not.toBeNull();
    // 若 fixedBarBottomPx 误把 composerHeightPx（这里量出 148）当 barHeightPx 传，抬升会是
    // translateY(-448px)；正确口径下 composer 自身不叠自身高度，仍是 -300px。
    expect(form?.style.transform).toBe("translateY(-300px)");

    await unmount(root);
  });
});

describe("TodoPage 多选态操作栏键盘避让", () => {
  it("多选态下键盘弹起，SelectionBar bottom 计入键盘高", async () => {
    await addTask({ title: "买灯", toInbox: true });
    mockKeyboardShown(300);
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");

    await enterSelection(host);
    const bar = selectionBar(host);
    expect(bar).not.toBeNull();
    // 多选态项目名输入框会弹键盘（B2 修正的那条注释）：fixedBarBottomPx 走同一合成，
    // navOffsetPx 被键盘高守卫归零，= 0（barHeightPx）+ 0（navOffsetPx）+ 300（键盘高）。
    expect((bar as HTMLElement).style.transform).toBe("translateY(-300px)");
    expect((bar as HTMLElement).style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });

  it("多选态下键盘收起（keyboard=0），SelectionBar bottom 与本轮前一致（= navOffsetPx）", async () => {
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");

    await enterSelection(host);
    const bar = selectionBar(host);
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.transform).toBe(`translateY(-${BOTTOM_NAV_HEIGHT_PX}px)`);
    expect((bar as HTMLElement).style.bottom).toBe("calc(0px + var(--safe-bottom))");

    await unmount(root);
  });
});
