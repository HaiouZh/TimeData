// @vitest-environment jsdom
import { createElement } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import { ErrorBoundary, RouteErrorFallback } from "./ErrorBoundary.js";

describe("ErrorBoundary", () => {
  it("shows fallback when child throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const Bad = () => {
      throw new Error("boom");
    };

    const { host, root } = await renderDom(createElement(ErrorBoundary, null, createElement(Bad)));

    expect(host.textContent).toContain("应用出错了");
    expect(host.textContent).toContain("boom");
    consoleError.mockRestore();
    await unmount(root);
  });
});

describe("RouteErrorFallback", () => {
  // 回归测试：App.tsx 的根路由（data router 下 index===0）总被 RR 包一层 boundary，
  // 不挂 errorElement 会落回 RR 自带未翻译兜底页，且这层在 App() 里 <ErrorBoundary> 之下、
  // 页面渲染错误冒不到它。这里复刻 App.tsx 同款「单条路由 + errorElement」结构，
  // 断言路由内渲染错误命中的是我们自己的兜底 UI，而不是 RR 的 DefaultErrorComponent。
  it("catches a render error inside the routed element with the shared fallback UI", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const Bad = () => {
      throw new Error("route boom");
    };
    const router = createMemoryRouter([
      { path: "*", element: createElement(Bad), errorElement: createElement(RouteErrorFallback) },
    ]);

    const { host, root } = await renderDom(createElement(RouterProvider, { router }));

    expect(host.textContent).toContain("应用出错了");
    expect(host.textContent).toContain("route boom");
    expect(host.textContent).not.toContain("Unexpected Application Error");
    consoleError.mockRestore();
    await unmount(root);
  });
});
