// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, type Root, unmount } from "../test/domHarness.js";

// 只钉 Bridge 自身的接线（CSS 变量写入 + 聚焦跟随滚动），键盘高的算法已由
// useKeyboardHeight.test.tsx 钉过，这里 mock 之。
const keyboardHeightMock = vi.hoisted(() => vi.fn(() => 0));
vi.mock("../hooks/useKeyboardHeight.ts", () => ({
  useKeyboardHeight: keyboardHeightMock,
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
