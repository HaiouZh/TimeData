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

  it("多次取用返回同一个实例，router 不随渲染重建", () => {
    expect(getRouter()).toBe(getRouter());
  });
});
