// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { db } from "../db/index.js";
import { addTask } from "../lib/tasks.js";
import { TodoPage } from "./TodoPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await db.tasks.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(SyncProvider, null, createElement(TodoPage)));
  });
  return { host, root };
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (host.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(`Timed out waiting for ${text}`);
}

describe("TodoPage", () => {
  it("renders pool and recurring blocks", async () => {
    await addTask({ title: "买啤酒" });
    await addTask({ title: "跑步", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const { host, root } = await renderPage();

    await waitForText(host, "买啤酒");

    expect(host.textContent).toContain("跑步");
    expect(host.textContent).toContain("重复任务");
    expect(host.textContent).toContain("任务池");
    await act(async () => root.unmount());
  });

  it("adds a pool task via input", async () => {
    const { host, root } = await renderPage();
    const input = host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement | null;
    const form = host.querySelector("form");

    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "新任务");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitForText(host, "新任务");
    await expect(db.tasks.toArray()).resolves.toMatchObject([{ title: "新任务", recurrence: null }]);
    await act(async () => root.unmount());
  });
});
