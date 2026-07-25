// @vitest-environment jsdom
import { createElement, useState } from "react";
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

function countButtons(host: HTMLElement, label: string): number {
  return Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === label).length;
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

  it("同一次拦截只弹一个确认（proceed 重复调用会抛，必须去重）", async () => {
    const { node } = renderAt(true);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => click(findLink(host, "去别处")));
    await flush();

    expect(countButtons(host, "继续编辑")).toBe(1);
    await unmount(root);
  });

  it("浏览器后退（POP）同样被拦下", async () => {
    const { router, node } = renderAt(true, ["/other", "/editor"], 1);
    const { host, root } = await renderDom(node);
    await flush();

    await act(async () => {
      void router.navigate(-1);
    });
    await flush();

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
});
