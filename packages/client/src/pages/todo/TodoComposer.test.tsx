// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomNavProvider, useBottomNav } from "../../contexts/BottomNavContext.js";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { TodoComposer } from "./TodoComposer.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await db.tasks.clear();
  await db.syncLog.clear();
});

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function Harness() {
  const { setHidden } = useBottomNav();
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", "data-testid": "hide-nav", onClick: () => setHidden(true) }, "hide"),
    createElement(TodoComposer, null),
  );
}

async function renderComposer() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(BottomNavProvider, null, createElement(SyncProvider, null, createElement(Harness, null))),
    ),
  );
  return { host, root };
}

const click = (el: Element | null) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

async function waitForInputValue(host: HTMLElement, expected: string) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const value = (host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement).value;
    if (value === expected) return;
    await flush();
  }
  throw new Error(`Timed out waiting for input value ${expected}`);
}

describe("TodoComposer", () => {
  it("输入标题后添加 → 创建普通任务并清空 title", async () => {
    const { host, root } = await renderComposer();
    await act(async () => setValue(host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement, "喝水"));

    await click(host.querySelector('button[type="submit"]'));
    await flush();

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("喝水");
    expect(tasks[0].recurrence).toBeNull();
    await waitForInputValue(host, "");
    await act(async () => root.unmount());
  });

  it("三件套不再有【重复】按钮", async () => {
    const { host, root } = await renderComposer();
    expect(host.querySelector('button[aria-label="重复"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("底栏 tab 收起时 composer 跟随贴底（bottom=0）", async () => {
    const { host, root } = await renderComposer();
    const form = host.querySelector("form") as HTMLFormElement;
    expect(Number.parseInt(form.style.bottom, 10)).toBe(49);

    await click(host.querySelector('[data-testid="hide-nav"]'));
    expect(Number.parseInt(form.style.bottom, 10)).toBe(0);
    await act(async () => root.unmount());
  });
});
