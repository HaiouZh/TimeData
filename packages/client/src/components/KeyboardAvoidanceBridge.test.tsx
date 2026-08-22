// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, type Root, unmount } from "../test/domHarness.js";

// 只钉 Bridge 自身的接线（CSS 变量写入 + 显式差值滚动 + 键盘落下时释放焦点），键盘高与在场
// 信号的算法已由 useKeyboardHeight.test.tsx 钉过，这里 mock 之。
const keyboardHeightMock = vi.hoisted(() => vi.fn(() => 0));
const keyboardVisibleMock = vi.hoisted(() => vi.fn(() => false));
const gapMock = vi.hoisted(() => vi.fn(() => 0));
vi.mock("../hooks/useKeyboardHeight.ts", () => ({
  useKeyboardHeight: keyboardHeightMock,
  useKeyboardVisible: keyboardVisibleMock,
  readViewportBottomGap: gapMock,
}));
const platformMock = vi.hoisted(() => vi.fn(() => "web"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: platformMock } }));

import { KeyboardAvoidanceBridge } from "./KeyboardAvoidanceBridge.js";

/** mock 返回值变了之后重渲染同一个 root（同类型元素 → React 更新而非重挂）。 */
async function rerenderBridge(root: Root): Promise<void> {
  await act(async () => root.render(createElement(KeyboardAvoidanceBridge)));
}

function rootVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

beforeEach(() => {
  keyboardHeightMock.mockReset();
  keyboardHeightMock.mockReturnValue(0);
  keyboardVisibleMock.mockReset();
  keyboardVisibleMock.mockReturnValue(false);
  gapMock.mockReset();
  gapMock.mockReturnValue(0);
  platformMock.mockReset();
  platformMock.mockReturnValue("web");
});

afterEach(() => {
  document.documentElement.style.removeProperty("--keyboard-inset");
  document.documentElement.style.removeProperty("--keyboard-scroll-padding");
});

describe("KeyboardAvoidanceBridge — 键盘遮挡量桥进全局 CSS 变量", () => {
  // iOS（resize:none）文档流表单页（EntryPage / 日记 / Sheet）没有 fixed 输入条那套 JS 避让，
  // 全靠这两个变量：--keyboard-inset 给容器让高（日记 / Sheet），--keyboard-scroll-padding 给
  // 滚动容器当 scroll-padding-bottom（聚焦滚动的落点留白，含「保存」按钮预留）。
  it("键盘弹起时把遮挡量写到 documentElement（inset = 键盘高，scroll-padding 含预留量）", async () => {
    keyboardHeightMock.mockReturnValue(300);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    expect(rootVar("--keyboard-inset")).toBe("300px");
    // 预留量 > 0（露出聚焦框下方的保存类按钮），具体数值由实现常量钉住，这里只钉「必须比键盘高」。
    const scrollPadding = Number.parseInt(rootVar("--keyboard-scroll-padding"), 10);
    expect(scrollPadding).toBeGreaterThan(300);

    await unmount(root);
  });

  it("键盘收起时移除变量（桌面浏览器 / 安卓壳已让位时恒如此，页面样式零残留）", async () => {
    keyboardHeightMock.mockReturnValue(300);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));
    expect(rootVar("--keyboard-inset")).toBe("300px");

    keyboardHeightMock.mockReturnValue(0);
    await rerenderBridge(root);

    expect(rootVar("--keyboard-inset")).toBe("");
    expect(rootVar("--keyboard-scroll-padding")).toBe("");

    await unmount(root);
  });
});

/** 视口几何 fixture：jsdom 无布局，rect / 溢出量 / 视口高全手工装。 */
function mountInputFixture(opts: { rectBottom: number; fixedAncestor?: boolean; noOverflow?: boolean }) {
  const host = document.createElement("div");
  if (opts.fixedAncestor) host.style.position = "fixed";
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: opts.noOverflow ? 600 : 1000 });
  const input = document.createElement("textarea");
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
    bottom: opts.rectBottom,
    top: opts.rectBottom - 60,
    left: 0,
    right: 100,
    width: 100,
    height: 60,
    x: 0,
    y: opts.rectBottom - 60,
    toJSON: () => ({}),
  } as DOMRect);
  scroller.appendChild(input);
  host.appendChild(scroller);
  document.body.appendChild(host);
  input.focus();
  return { scroller, input, host };
}

/** 显式接管视口高度与 visualViewport；不传 vv 则显式置 undefined，钉死「无 vv」分支（jsdom 行为不定）。 */
function setViewport(innerHeight: number, vv?: { offsetTop: number; height: number }) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: vv
      ? { offsetTop: vv.offsetTop, height: vv.height, addEventListener: vi.fn(), removeEventListener: vi.fn() }
      : undefined,
  });
}

function restoreViewport() {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
}

// 落点不委托引擎（scrollIntoView 的 nearest 在 iOS resize:none 下判「已可见」直接 no-op，
// CSS scroll-padding 又在安卓壳让位的窗口期把过期键盘量喂给 Blink 原生聚焦滚动 = 双倍让位），
// 由 JS 按 rect.bottom + 96 - 键盘上沿 算差值，只补不足不回滚。这里钉几何与两条触发路径。
describe("KeyboardAvoidanceBridge - 显式差值滚动", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    restoreViewport();
  });

  it("无 vv（iOS resize:none 失明）：按插件高度算底线，滚出差值（550+96-(800-300)=146）", async () => {
    setViewport(800);
    const f = mountInputFixture({ rectBottom: 550 });
    keyboardHeightMock.mockReturnValue(0);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    keyboardHeightMock.mockReturnValue(300);
    await rerenderBridge(root);
    expect(f.scroller.scrollTop).toBe(146);

    await unmount(root);
  });

  it("android overlay（壳不动、vv 报不出遮挡）：底线回落插件高度，滚出差值（与 iOS 同款）", async () => {
    // 安卓壳不再消费 ime inset：键盘盖在 WebView 上，vv 全程满高、报不出遮挡——
    // 恒信 vv 会把底线算成整个视口高、差值恒负、聚焦滚动整层失明（日记等文档流表单被键盘盖住）。
    platformMock.mockReturnValue("android");
    setViewport(800, { offsetTop: 0, height: 800 });
    const f = mountInputFixture({ rectBottom: 550 });
    keyboardHeightMock.mockReturnValue(0);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    keyboardHeightMock.mockReturnValue(300);
    await rerenderBridge(root);
    expect(f.scroller.scrollTop).toBe(146);

    await unmount(root);
  });

  it("高度正->正（120->300，键盘动画中间值 / 拼音候选条加高）持续补足，已到位不回滚", async () => {
    setViewport(800);
    const f = mountInputFixture({ rectBottom: 550 });
    keyboardHeightMock.mockReturnValue(0);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    keyboardHeightMock.mockReturnValue(120); // 底线 680，deficit -34：不滚
    await rerenderBridge(root);
    expect(f.scroller.scrollTop).toBe(0);

    keyboardHeightMock.mockReturnValue(300); // 底线 500，deficit 146：补足
    await rerenderBridge(root);
    expect(f.scroller.scrollTop).toBe(146);

    await unmount(root);
  });

  it("Android 壳缩竞态：resize 先到、height state 仍 300（stale），底线按实时 vv=700 算，不多滚一个 K", async () => {
    setViewport(700, { offsetTop: 0, height: 700 }); // 壳已缩完，vv 与 innerHeight 同步为真值
    const f = mountInputFixture({ rectBottom: 550 });
    keyboardVisibleMock.mockReturnValue(true);
    keyboardHeightMock.mockReturnValue(300); // stale 值：正确实现走 vv 分支、忽略它
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    window.dispatchEvent(new Event("resize"));
    // 错误实现（回落 state）会把底线算成 700-300=400、多滚 550+96-400=246
    expect(f.scroller.scrollTop).toBe(0);

    await unmount(root);
  });

  it("iOS vv 报得出遮挡：底线用 vv 底（520），不用插件高度回落（800-260=540）", async () => {
    platformMock.mockReturnValue("ios");
    gapMock.mockReturnValue(280); // > 0：vv 分支生效
    setViewport(800, { offsetTop: 0, height: 520 });
    const f = mountInputFixture({ rectBottom: 550 });
    keyboardHeightMock.mockReturnValue(0);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    keyboardHeightMock.mockReturnValue(260);
    await rerenderBridge(root);
    expect(f.scroller.scrollTop).toBe(126); // 550+96-520；若错走回落分支则是 106

    await unmount(root);
  });

  it("焦点在 fixed 输入条（速记/待办 composer）内：不滚文档流", async () => {
    setViewport(800);
    const f = mountInputFixture({ rectBottom: 550, fixedAncestor: true });
    keyboardHeightMock.mockReturnValue(300);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    expect(f.scroller.scrollTop).toBe(0);

    await unmount(root);
  });

  it("滚动容器无溢出（短表单且无 padding 制造空间）：找不到 scroller，不滚不炸", async () => {
    setViewport(800);
    const f = mountInputFixture({ rectBottom: 550, noOverflow: true });
    keyboardHeightMock.mockReturnValue(300);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    expect(f.scroller.scrollTop).toBe(0);

    await unmount(root);
  });

  it("焦点不在可输入元素上（如 body）时不滚动", async () => {
    setViewport(800);
    const f = mountInputFixture({ rectBottom: 550 });
    f.input.blur();
    keyboardHeightMock.mockReturnValue(300);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    expect(f.scroller.scrollTop).toBe(0);

    await unmount(root);
  });
});

// iOS 真机：用输入法自带的收起键收键盘只收键盘、**不摘网页焦点**，输入框仍是 DOM 焦点、
// WKWebView 的内容视图仍是 first responder——之后碰屏幕上任何东西，WebKit 都会把键盘重新
// 弹回来（用户实测「点什么都会先弹一次」）。切 tab 那一下最刺眼：键盘弹起后导航把上一层打成
// inert，规范要求 blur 掉层内焦点元素，键盘立刻又落下，叠上懒加载 chunk 的延迟，观感就是
// 「先弹一次、落一次、才切换」。故键盘落下的那一跳必须由网页层主动收掉焦点。
describe("KeyboardAvoidanceBridge — 键盘落下时释放输入焦点", () => {
  it("键盘从在场变不在场时，把仍持焦点的输入框 blur 掉", async () => {
    keyboardVisibleMock.mockReturnValue(true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));
    // 键盘还在场时不许动焦点：用户正在打字。
    expect(document.activeElement).toBe(input);

    keyboardVisibleMock.mockReturnValue(false);
    await rerenderBridge(root);

    expect(document.activeElement).not.toBe(input);

    input.remove();
    await unmount(root);
  });

  // 真闸：本例必须钉「挂载那一跑」。写成「挂载后才聚焦、再重渲染」是假闸——keyboardVisible
  // false→false 时 effect 依赖没变、React 压根不重跑，守卫拆了也不会红。桌面浏览器该值恒 false，
  // 唯一会跑到收焦点分支的时机就是挂载：此时用户可能正敲着字，绝不能把光标踢出去。
  it("键盘从未在场（桌面浏览器）时不碰焦点——只认「在场→不在场」那一跳", async () => {
    keyboardVisibleMock.mockReturnValue(false);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));
    expect(document.activeElement).toBe(input);

    await rerenderBridge(root);
    expect(document.activeElement).toBe(input);

    input.remove();
    await unmount(root);
  });

  // iOS resize:none 下 WebKit 为露出聚焦框会平移/滚动窗口，收起后可能残留 window.scrollY——
  // h-dvh 布局整体被顶上去，底栏「整体向上移动」（用户真机实测）。收起那一跳显式归零，
  // 对应 Telegram 的「收起与弹起同管线 + 强制归零防护」。
  it("ios：键盘在场→不在场时，window 残留滚动位移滚回 0", async () => {
    platformMock.mockReturnValue("ios");
    keyboardVisibleMock.mockReturnValue(true);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 120 });
    const scrollToSpy = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollToSpy });

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));
    expect(scrollToSpy).not.toHaveBeenCalled();

    keyboardVisibleMock.mockReturnValue(false);
    await rerenderBridge(root);

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await unmount(root);
  });

  it("ios：无残留（scrollY=0）时不调用 scrollTo", async () => {
    platformMock.mockReturnValue("ios");
    keyboardVisibleMock.mockReturnValue(true);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    const scrollToSpy = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollToSpy });

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));
    keyboardVisibleMock.mockReturnValue(false);
    await rerenderBridge(root);

    expect(scrollToSpy).not.toHaveBeenCalled();

    await unmount(root);
  });

  it("非 ios 平台：即使有残留滚动也不碰（桌面 / 安卓滚动位置不归 Bridge 管）", async () => {
    platformMock.mockReturnValue("web");
    keyboardVisibleMock.mockReturnValue(true);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 120 });
    const scrollToSpy = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollToSpy });

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));
    keyboardVisibleMock.mockReturnValue(false);
    await rerenderBridge(root);

    expect(scrollToSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await unmount(root);
  });

  it("键盘落下时焦点在按钮上（非可输入元素）则不动它", async () => {
    keyboardVisibleMock.mockReturnValue(true);
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    keyboardVisibleMock.mockReturnValue(false);
    await rerenderBridge(root);

    expect(document.activeElement).toBe(button);

    button.remove();
    await unmount(root);
  });
});
