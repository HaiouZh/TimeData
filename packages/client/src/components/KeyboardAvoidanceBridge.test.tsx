// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, type Root, unmount } from "../test/domHarness.js";

// 只钉 Bridge 自身的接线（CSS 变量写入 + 聚焦跟随滚动 + 键盘落下时释放焦点），键盘高与在场
// 信号的算法已由 useKeyboardHeight.test.tsx 钉过，这里 mock 之。
const keyboardHeightMock = vi.hoisted(() => vi.fn(() => 0));
const keyboardVisibleMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../hooks/useKeyboardHeight.ts", () => ({
  useKeyboardHeight: keyboardHeightMock,
  useKeyboardVisible: keyboardVisibleMock,
}));

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

describe("KeyboardAvoidanceBridge — 键盘弹起瞬间的聚焦跟随滚动", () => {
  it("键盘 0→正 且焦点在 textarea 上时，把聚焦元素 scrollIntoView 到键盘上方", async () => {
    keyboardHeightMock.mockReturnValue(0);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const scrollSpy = vi.fn();
    (textarea as unknown as { scrollIntoView: typeof scrollSpy }).scrollIntoView = scrollSpy;
    textarea.focus();

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));
    expect(scrollSpy).not.toHaveBeenCalled();

    keyboardHeightMock.mockReturnValue(300);
    await rerenderBridge(root);

    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" }));

    textarea.remove();
    await unmount(root);
  });

  it("键盘高度在正值间微调（300→302，visualViewport 抖动）不重复滚动", async () => {
    keyboardHeightMock.mockReturnValue(0);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const scrollSpy = vi.fn();
    (textarea as unknown as { scrollIntoView: typeof scrollSpy }).scrollIntoView = scrollSpy;
    textarea.focus();

    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    keyboardHeightMock.mockReturnValue(300);
    await rerenderBridge(root);
    keyboardHeightMock.mockReturnValue(302);
    await rerenderBridge(root);

    expect(scrollSpy).toHaveBeenCalledTimes(1);

    textarea.remove();
    await unmount(root);
  });

  it("焦点不在可输入元素上（如 body）时不滚动", async () => {
    keyboardHeightMock.mockReturnValue(0);
    const { root } = await renderDom(createElement(KeyboardAvoidanceBridge));

    // 无聚焦输入框时弹键盘（如安卓外接场景）：不做任何滚动动作，也不抛错。
    keyboardHeightMock.mockReturnValue(300);
    await rerenderBridge(root);

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
