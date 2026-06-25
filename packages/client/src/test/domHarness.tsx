import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hostRoots = new WeakMap<Root, HTMLElement>();

export async function renderDom(node: ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  hostRoots.set(root, host);
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
}
