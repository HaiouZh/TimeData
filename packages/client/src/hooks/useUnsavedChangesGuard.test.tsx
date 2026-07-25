// @vitest-environment jsdom
import { createElement, act as reactAct, useState } from "react";
import { flushSync } from "react-dom";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
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
