import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

export type { Root } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hostRoots = new WeakMap<Root, HTMLElement>();
// 活跃 root 登记（WeakMap 不可枚举，故另用 Set 供 cleanupRoots 遍历）：
// isolate:false 的 jsdom 快桶里，未手动 unmount 的 root 会把 DOM/Provider 残留泄漏给下个文件，
// setup.clean-jsdom.ts 的 afterEach 调 cleanupRoots() 兜底卸载。
const activeRoots = new Set<Root>();

export async function renderDom(node: ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  hostRoots.set(root, host);
  activeRoots.add(root);
  await act(async () => root.render(node));
  return { host, root };
}

export async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

export async function doubleClick(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  });
}

export async function pressKey(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

export async function unmount(root: Root): Promise<void> {
  await act(async () => root.unmount());
  // 顺手把 host 从 body 摘掉——React unmount 卸载它的 portal 子树，但 host 自身留在 body 上，
  // 多个 sheet/popover 测试堆积时会让 document.body.querySelector(...) 取到上一条遗留节点。
  const host = hostRoots.get(root);
  if (host?.parentElement) host.parentElement.removeChild(host);
  hostRoots.delete(root);
  activeRoots.delete(root);
}

// 卸载所有仍活跃（未手动 unmount）的 root。jsdom 快桶 afterEach 兜底用；
// 已手动 unmount 的 root 已从 activeRoots 移除，故重复调用无副作用。幂等。
export async function cleanupRoots(): Promise<void> {
  for (const root of [...activeRoots]) await unmount(root);
}
