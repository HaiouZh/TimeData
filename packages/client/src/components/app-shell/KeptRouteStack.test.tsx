// @vitest-environment jsdom
import { createElement, useState } from "react";
import { type Location, MemoryRouter, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn(() => "ios"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: getPlatformMock, isNativePlatform: () => true } }));

// 用极简路由表替掉真实 AppRoutes：本用例要验的是栈行为，不是页面内容。
const mountCounts: Record<string, number> = {};
vi.mock("./AppRoutes.tsx", () => ({
  AppRoutes: ({ location }: { location?: { pathname: string } }) => {
    const path = location?.pathname ?? "/";
    // 计数写在 useState 初始化器里：它只在**挂载**那一次跑。写在函数体里数的是渲染次数——
    // 栈每次推进都会让保留层重渲染一次（元素对象是新的，React 不会 bail out），
    // 那样连正确实现都恒红，闸就成了噪声。
    // mountedPath 记下「这棵树当初是为哪一页挂的」：key 写错（如 key={index}）时 React 会把
    // 上一页的树留在原位改渲染本页，DOM/state 其实已经串了——它与当前 path 不符即暴露。
    const [mountedPath] = useState(() => {
      mountCounts[path] = (mountCounts[path] ?? 0) + 1;
      return path;
    });
    return createElement("div", { "data-page": path, "data-mounted-path": mountedPath });
  },
}));

// 底栏同样替成桩：真件要 BottomNavProvider + 设置/db，与「栈行为」无关。
// 桩保留一个可查询的标记，好钉住「底栏在层内、不在栈外」这条布局契约。
vi.mock("./MobileBottomNav.tsx", () => ({
  MobileBottomNav: () => createElement("nav", { "data-bottom-nav": "" }),
}));

import { KeptRouteStack, nextStack } from "./KeptRouteStack.tsx";

/** 三个按钮各跳一处，用 domHarness 的 click（已包 act）逐次推进。 */
function Nav() {
  const navigate = useNavigate();
  return createElement(
    "div",
    null,
    createElement("button", {
      type: "button",
      "data-testid": "to-data",
      onClick: () => navigate("/settings/data"),
    }),
    createElement("button", {
      type: "button",
      "data-testid": "to-cat",
      onClick: () => navigate("/settings/categories/c1"),
    }),
    createElement("button", { type: "button", "data-testid": "go-back", onClick: () => navigate(-1) }),
  );
}

function loc(pathname: string, key: string): Location {
  return { pathname, search: "", hash: "", state: null, key };
}

beforeEach(() => {
  for (const k of Object.keys(mountCounts)) delete mountCounts[k];
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("ios");
});

describe("nextStack", () => {
  it("同一条历史不重复入栈", () => {
    const a = loc("/todo", "k1");
    const prev = [a];
    expect(nextStack(prev, loc("/todo", "k1"))).toBe(prev);
  });

  it("超过两层时从头部丢，剩余顺序不变", () => {
    const a = loc("/todo", "k1");
    const b = loc("/settings/data", "k2");
    const c = loc("/settings/categories/c1", "k3");
    const result = nextStack([a, b], c);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(c);
  });

  it("回到栈里已有的 key 时截断到那一层（复用而非新建）", () => {
    const a = loc("/todo", "k1");
    const b = loc("/settings/data", "k2");
    const result = nextStack([a, b], loc("/todo", "k1"));
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(a);
  });
});

describe("KeptRouteStack", () => {
  it("初始只有一层，且是 active", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/todo"] }, createElement(KeptRouteStack, {})),
    );
    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    expect(host.querySelector('[data-kept-layer="active"]')).not.toBeNull();
    await unmount(root);
  });

  it("进子页后保留上一层，且上一层用 visibility 隐藏、不是 display:none", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    await click(host.querySelector('[data-testid="to-data"]'));

    const kept = host.querySelector('[data-kept-layer="kept"]') as HTMLElement;
    expect(kept).not.toBeNull();
    expect(kept.style.visibility).toBe("hidden");
    expect(kept.style.display).not.toBe("none");
    expect(kept.querySelector('[data-page="/todo"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    // 底栏在层内而非栈外：返回手势里上一页的底栏要跟着一起滑回来（已知取舍见组件注释）。
    expect(kept.querySelector("[data-bottom-nav]")).not.toBeNull();
    await unmount(root);
  });

  it("最多留两层，超出从头部丢且剩余层不重新挂载", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    await click(host.querySelector('[data-testid="to-data"]'));
    expect(mountCounts["/settings/data"]).toBe(1);

    await click(host.querySelector('[data-testid="to-cat"]'));

    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    // /todo 那层被丢弃，/settings/data 从 active 变 kept——**不能**因此重新挂载。
    // 这条是「页面不关」是否真的成立的核心闸：涨到 2 就说明 React 重建了那棵树，位置与 state 全丢。
    expect(mountCounts["/settings/data"]).toBe(1);
    const kept = host.querySelector('[data-kept-layer="kept"]') as HTMLElement;
    const keptPage = kept.querySelector('[data-page="/settings/data"]');
    expect(keptPage).not.toBeNull();
    // 且必须是**当初为 /settings/data 挂的那棵树**，不是被 React 挪来改渲染的 /todo 那棵。
    // key 用 index 而非 location.key 时这里会读到 "/todo"：DOM 复用了，滚动位置与 state 已经串了。
    expect(keptPage?.getAttribute("data-mounted-path")).toBe("/settings/data");
    await unmount(root);
  });

  it("回退时保留层升为 active，且仍不重新挂载", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    await click(host.querySelector('[data-testid="to-data"]'));
    await click(host.querySelector('[data-testid="go-back"]'));

    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    expect(mountCounts["/todo"]).toBe(1);
    const active = host.querySelector('[data-kept-layer="active"]') as HTMLElement;
    expect(active.querySelector('[data-page="/todo"]')).not.toBeNull();
    await unmount(root);
  });

  it("非 iOS 平台不渲染栈，只渲染单层", async () => {
    getPlatformMock.mockReturnValue("web");
    const { host, root } = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/todo"] }, createElement(KeptRouteStack, {})),
    );
    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    await unmount(root);
  });
});
