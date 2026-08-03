// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "./contexts/BottomNavContext.js";
import { click, renderDom, unmount } from "./test/domHarness.js";

// 平台闸的唯一实现点在 App.tsx（`Capacitor.getPlatform() === "ios"`），KeptRouteStack 通篇没有
// Capacitor 引用。所以这条闸只能在 App 层建：在 KeptRouteStack.test.tsx 里 mock getPlatform
// 是空转的——那边曾有一条「非 iOS 平台不渲染栈」的用例，mock 没被任何代码读过，
// 断言与「初始只有一层」逐字相同，两条同生同死（把 App.tsx 判据写反，23 条用例全绿）。
const getPlatformMock = vi.hoisted(() => vi.fn(() => "ios"));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: getPlatformMock, isNativePlatform: () => getPlatformMock() !== "web" },
}));

// 路由内容与本闸无关，换成最轻的桩：真件会拉起 30 余个 lazy 页面。
vi.mock("./components/app-shell/AppRoutes.tsx", () => ({
  AppRoutes: () => createElement("div", { "data-routes": "" }),
}));
// 底栏刻意用真件：本文件同时要钉住「iOS 与非 iOS 用同一份 layoutHidesBottomNav 判据」，
// 桩掉它就等于把被测对象换成了桩。
vi.mock("./components/AppUpdatePrompt.tsx", () => ({ default: () => null }));
vi.mock("./components/AndroidBackButtonHandler.tsx", () => ({ default: () => null }));
vi.mock("./components/EdgeSwipeBack.tsx", () => ({ default: () => null }));
vi.mock("./components/TotpPromptDialog.tsx", () => ({ TotpPromptDialog: () => null }));

import { AppShell } from "./App.js";

beforeEach(() => {
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("ios");
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

/** 栈外的导航按钮：推进一次 PUSH，用来看上一页有没有被留下。 */
function Nav() {
  const navigate = useNavigate();
  return createElement("button", {
    type: "button",
    "data-testid": "to-data",
    onClick: () => navigate("/settings/data"),
  });
}

async function renderShell(pathname: string) {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [pathname] },
      createElement(BottomNavProvider, null, createElement(AppShell), createElement(Nav)),
    ),
  );
}

describe("AppShell 的 iOS 平台闸", () => {
  it("iOS 渲染保留上一页的路由栈", async () => {
    getPlatformMock.mockReturnValue("ios");
    const { host, root } = await renderShell("/");

    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    expect(host.querySelector('[data-kept-layer="active"]')).not.toBeNull();
    await unmount(root);
  });

  for (const platform of ["android", "web"]) {
    it(`${platform} 一层都不渲染，走的是改前那条单层渲染路径`, async () => {
      // App.tsx 的注释白纸黑字承诺「其余平台渲染路径一字不改」。判据写反时这条必红。
      getPlatformMock.mockReturnValue(platform);
      const { host, root } = await renderShell("/");

      expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(0);
      // 但页面本身照常渲染：不能靠「什么都没渲染出来」蒙混过关。
      expect(host.querySelector("[data-routes]")).not.toBeNull();
      await unmount(root);
    });
  }

  it("iOS 钻进子页后上一页留在栈里；安卓走的是「一页一换」的老路径", async () => {
    // 前两条只数标记，接上的哪怕是个只会吐 data-kept-layer 的空壳也能绿。这条要的是**效果**：
    // 进子页后 iOS 有两层（上一页没卸载，手势才有活底层可露），安卓仍是零层。
    getPlatformMock.mockReturnValue("ios");
    const ios = await renderShell("/");
    await click(ios.host.querySelector('[data-testid="to-data"]'));
    expect(ios.host.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    expect(ios.host.querySelector('[data-kept-layer="kept"]')).not.toBeNull();
    await unmount(ios.root);

    getPlatformMock.mockReturnValue("android");
    const android = await renderShell("/");
    await click(android.host.querySelector('[data-testid="to-data"]'));
    expect(android.host.querySelectorAll("[data-kept-layer]")).toHaveLength(0);
    await unmount(android.root);
  });

  // layoutHidesBottomNav 曾在 App.tsx 与 KeptRouteStack.tsx 各抄一份、两份都零覆盖（改成恒 false
  // 测试全绿）。两边分头演化就是「一个平台的设置子页底下多出一条底栏压着内容」，且没人会红。
  // 这里把两条渲染路径放进同一条用例，判据一旦分叉必有一边先红。
  for (const platform of ["ios", "android"]) {
    it(`${platform}：tab 主页有底栏，设置子页没有`, async () => {
      getPlatformMock.mockReturnValue(platform);
      const home = await renderShell("/");
      expect(home.host.querySelector('nav[aria-label="主导航"]')).not.toBeNull();
      await unmount(home.root);

      const sub = await renderShell("/settings/data");
      expect(sub.host.querySelector('nav[aria-label="主导航"]')).toBeNull();
      await unmount(sub.root);
    });
  }
});
