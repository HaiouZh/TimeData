// @vitest-environment jsdom
import { createElement, act as reactAct, useState } from "react";
import { flushSync } from "react-dom";
import { createMemoryRouter, Link, Outlet } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import { KeptLayerActiveContext } from "../components/app-shell/keptLayerActive.js";
import { click, renderDom, unmount } from "../test/domHarness.js";
import { useConfirm } from "./useConfirm.js";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard.js";

async function act(callback: () => Promise<void> | void) {
  let result: Promise<void> | void;
  flushSync(() => {
    result = callback();
  });
  await result;
  flushSync(() => {});
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** 被守卫的编辑页：勾上"脏"后离开应被拦截 */
function EditorPage({ initialDirty }: { initialDirty: boolean }) {
  const [dirty, setDirty] = useState(initialDirty);
  const { confirm, dialog } = useConfirm();
  useUnsavedChangesGuard({ when: dirty, confirm });
  return createElement(
    "div",
    null,
    dialog,
    createElement("span", null, "编辑页"),
    createElement(Link, { to: "/other" }, "去别处"),
    createElement(Link, { to: "/editor" }, "原地链接"),
    createElement("button", { type: "button", onClick: () => setDirty(false) }, "清脏"),
  );
}

function renderAt(initialDirty: boolean, entries: string[] = ["/editor"], index = 0) {
  const router = createMemoryRouter(
    [
      { path: "/editor", element: createElement(EditorPage, { initialDirty }) },
      { path: "/other", element: createElement("span", null, "别处") },
      { path: "/third", element: createElement("span", null, "第三处") },
    ],
    { initialEntries: entries, initialIndex: index },
  );
  return { router, node: createElement(RouterProvider, { router }) };
}

// ConfirmSheet 不走 portal，渲染在组件树内，所以从 host 里找即可（别用 document，
// 那样 host 参数会变成未使用变量、biome 报错）
function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`);
  return found;
}

function hasButton(host: HTMLElement, label: string): boolean {
  return Array.from(host.querySelectorAll("button")).some((b) => b.textContent?.trim() === label);
}

function findLink(host: HTMLElement, label: string): HTMLAnchorElement {
  const found = Array.from(host.querySelectorAll("a")).find((a) => a.textContent?.trim() === label);
  if (!(found instanceof HTMLAnchorElement)) throw new Error(`missing link: ${label}`);
  return found;
}

describe("useUnsavedChangesGuard", () => {
  it("when 为 false 时，点链接直接跳走，不弹确认", async () => {
    const { router, node } = renderAt(false);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去别处")));
    await flush();

    expect(router.state.location.pathname).toBe("/other");
    await unmount(root);
  });

  it("when 为 true 时点链接被拦下并弹确认，点「继续编辑」留在原页", async () => {
    const { router, node } = renderAt(true);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去别处")));
    await flush();

    expect(findButton(host, "继续编辑")).toBeTruthy();

    await act(async () => click(findButton(host, "继续编辑")));
    await flush();

    expect(router.state.location.pathname).toBe("/editor");
    await unmount(root);
  });

  it("点「放弃修改」后放行到目标页", async () => {
    const { router, node } = renderAt(true);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去别处")));
    await flush();
    await act(async () => click(findButton(host, "放弃修改")));
    await flush();

    expect(router.state.location.pathname).toBe("/other");
    await unmount(root);
  });

  it("浏览器后退（POP）同样被拦下", async () => {
    const { router, node } = renderAt(true, ["/other", "/editor"], 1);
    const { host, root } = await renderDom(node);
    await flush();

    // 直接调 router.navigate(...) 得用 React 真正的 act（而非本文件的 flushSync 版 act()）
    // 并 await 掉：导航是异步的，它触发的状态更新落在 flushSync 的同步作用域之外，
    // flushSync 版 act() 包不住，会报 "not wrapped in act(...)"。
    await reactAct(async () => {
      await router.navigate(-1);
    });

    expect(findButton(host, "继续编辑")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/editor");
    await unmount(root);
  });

  it("同路径导航不拦（避免自跳转误触发）", async () => {
    const { router, node } = renderAt(true);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "原地链接")));
    await flush();

    expect(router.state.location.pathname).toBe("/editor");
    expect(hasButton(host, "继续编辑")).toBe(false);
    await unmount(root);
  });

  // 这条是真正承重的回归测试：blockerRef 存在的唯一理由。见 useUnsavedChangesGuard.ts 的 JSDoc。
  // 已用「还原成 v1 效果体（cancelled + [blocker,...] 依赖）」验证过：还原后这条会变红
  // （落到 /editor 而非 /third），证明它确实在守护这个行为，不是摆设。
  it("blocked 期间又来一次导航，「放弃修改」放行到最新目标而非第一次拦下的那个", async () => {
    const { router, node } = renderAt(true);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去别处")));
    await flush();
    expect(findButton(host, "继续编辑")).toBeTruthy();

    // 第一次拦截尚未回应时又来一次导航到别的目标：effect 依赖的 blockerState 仍是
    // "blocked"（不会重跑），但 blocker 对象本身换了个新的、location 指向 /third。
    // 同上一条用例：直接调 router.navigate(...) 得用 React 真正的 act 并 await。
    await reactAct(async () => {
      await router.navigate("/third");
    });
    expect(findButton(host, "继续编辑")).toBeTruthy();

    await act(async () => click(findButton(host, "放弃修改")));
    await flush();

    // 若 resolve 时拿的是闭包里第一次的旧 blocker 对象，会错误跳到 /other。
    expect(router.state.location.pathname).toBe("/third");
    await unmount(root);
  });

  it("blocked 状态下直接卸载，不抛错（cleanup 已 deleteBlocker，无需手动 reset）", async () => {
    const { node } = renderAt(true);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去别处")));
    await flush();
    expect(findButton(host, "继续编辑")).toBeTruthy();

    await expect(unmount(root)).resolves.toBeUndefined();
  });
});

/**
 * iOS 的 KeptRouteStack 让上一页**不卸载**，于是「卸载即注销 blocker」这条前提在保留层上失效：
 * 一个屏幕上完全看不见的页面，仍在全局注册 useBlocker，会用自己的脏态拦住**当前页**的导航。
 * 下面用「脏编辑页常驻在布局里、路由内容另在 Outlet 里换」来复刻这个形状——
 * 脏页始终挂着，导航发生在它之外，正是保留层的真实处境。
 */
function KeptEditor() {
  const { confirm, dialog } = useConfirm();
  useUnsavedChangesGuard({ when: true, confirm });
  return createElement("div", null, dialog, createElement("span", null, "常驻的脏编辑页"));
}

/** layerActive 传 undefined = 不套 Provider，复刻非 iOS 渲染路径（子树只能吃 createContext 的缺省值）。 */
function LayerShell({ layerActive }: { layerActive?: boolean }) {
  const editor =
    layerActive === undefined
      ? createElement(KeptEditor)
      : createElement(KeptLayerActiveContext.Provider, { value: layerActive }, createElement(KeptEditor));
  return createElement("div", null, editor, createElement(Link, { to: "/third" }, "去第三处"), createElement(Outlet));
}

function renderLayerCase(layerActive?: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(LayerShell, { layerActive }),
        children: [
          { path: "other", element: createElement("span", null, "别处") },
          { path: "third", element: createElement("span", null, "第三处") },
        ],
      },
    ],
    { initialEntries: ["/other"] },
  );
  return { router, node: createElement(RouterProvider, { router }) };
}

describe("useUnsavedChangesGuard 与 iOS 保留层", () => {
  it("隐藏的保留层脏着，也不拦当前层的导航（不弹凭空的「放弃未保存的修改？」）", async () => {
    const { router, node } = renderLayerCase(false);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去第三处")));
    await flush();

    // 修复前：blocker 用隐藏页的脏态拦下，用户在当前页凭空看到确认框，选「继续编辑」还会被钉住。
    expect(hasButton(host, "继续编辑")).toBe(false);
    expect(router.state.location.pathname).toBe("/third");
    await unmount(root);
  });

  it("当前活跃层脏着，照常拦下并弹确认", async () => {
    const { router, node } = renderLayerCase(true);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去第三处")));
    await flush();

    expect(findButton(host, "继续编辑")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/other");
    await unmount(root);
  });

  it("非 iOS 渲染路径（压根没有 Provider）缺省视为活跃，守卫行为一字不改", async () => {
    // 这条钉的是 keptLayerActive.ts 的缺省值：写成 false 就会把桌面 / 安卓 / Web 的守卫一起
    // 静默关掉——那比原缺陷更严重（真的会丢用户没保存的字）。
    const { router, node } = renderLayerCase(undefined);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去第三处")));
    await flush();

    expect(findButton(host, "继续编辑")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/other");
    await unmount(root);
  });
});
