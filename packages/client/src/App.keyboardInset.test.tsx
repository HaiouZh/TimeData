// @vitest-environment jsdom
// 钉 AppShell 的键盘桥接线：KeyboardAvoidanceBridge 必须真挂在 AppShell 里（两条渲染路径共用的
// 顶层），键盘弹起时全局 CSS 变量才有人写——EntryPage / 日记 / Sheet 的避让全部消费它。
// Bridge 自身行为已由 KeyboardAvoidanceBridge.test.tsx 钉过，这里只测「挂上了、生效了」。
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "./contexts/BottomNavContext.js";
import { renderDom, unmount } from "./test/domHarness.js";

const keyboardHeightMock = vi.hoisted(() => vi.fn(() => 0));
const keyboardVisibleMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("./hooks/useKeyboardHeight.ts", () => ({
  useKeyboardHeight: keyboardHeightMock,
  useKeyboardVisible: keyboardVisibleMock,
}));
vi.mock("./components/AppUpdatePrompt.tsx", () => ({ default: () => null }));
vi.mock("./components/AndroidBackButtonHandler.tsx", () => ({ default: () => null }));
vi.mock("./pages/QuickNotesPage.tsx", () => ({ default: () => createElement("div", null, "速记页面") }));
vi.mock("./pages/TimelinePage.tsx", () => ({ default: () => createElement("div", null, "时间轴页面") }));

import { AppShell } from "./App.js";

beforeEach(() => {
  document.body.innerHTML = "";
  keyboardHeightMock.mockReset();
  keyboardHeightMock.mockReturnValue(0);
  keyboardVisibleMock.mockReset();
  keyboardVisibleMock.mockReturnValue(false);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  document.documentElement.style.removeProperty("--keyboard-inset");
  document.documentElement.style.removeProperty("--keyboard-scroll-padding");
});

describe("AppShell 键盘桥接线", () => {
  it("键盘弹起时 AppShell 把 --keyboard-inset 写上 documentElement（Bridge 已挂载生效）", async () => {
    keyboardHeightMock.mockReturnValue(300);
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(BottomNavProvider, null, createElement(AppShell)),
      ),
    );

    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("300px");

    await unmount(root);
  });

  it("滚动容器 main 带 app-main 类（scroll-padding 规则的挂点，见 index.css）", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(BottomNavProvider, null, createElement(AppShell)),
      ),
    );

    const main = host.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.classList.contains("app-main")).toBe(true);

    await unmount(root);
  });
});
