// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getRouter } from "./App.js";

describe("App router", () => {
  it("导出的是 data router 实例（useBlocker 的硬前提）", () => {
    // data router 独有：state 快照 + 编程式 navigate。
    // 组件式 <BrowserRouter> 不产出这样的实例，拿不到 DataRouterContext，
    // useBlocker 会直接抛 "useBlocker must be used within a data router."
    const router = getRouter();
    expect(router.state).toBeDefined();
    expect(router.state.location.pathname).toBe("/");
    expect(typeof router.navigate).toBe("function");
  });

  it("splat 路由承载全部路径，深层路径也能匹配到根布局", () => {
    const router = getRouter();
    const matches = router.routes[0];
    expect(matches.path).toBe("*");
  });

  it("根路由挂了 errorElement，页面崩溃不会落回 RR 自带的未翻译兜底页", () => {
    // 接线断言：RR 对根路由（index 0）总会包一层 boundary，不给 errorElement 就用它自带的
    // DefaultErrorComponent，而那层在 RouterProvider 内、页面渲染错误冒不到 App() 的 ErrorBoundary。
    // 删掉 App.tsx 的 errorElement 这条就会红。（RouteErrorFallback 渲染出什么由
    // ErrorBoundary.test.tsx 覆盖。）v7 时这里断的是 RR 内部推导出的 hasErrorBoundary，
    // v8 把那个内部字段从 router.routes 上删了，改断 errorElement 本身——正是它的推导来源。
    expect(getRouter().routes[0].errorElement).toBeDefined();
  });

  it("多次取用返回同一个实例，router 不随渲染重建", () => {
    expect(getRouter()).toBe(getRouter());
  });
});
