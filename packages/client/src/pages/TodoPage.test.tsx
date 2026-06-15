// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { db } from "../db/index.js";
import { addTask, updateSubtasks } from "../lib/tasks.js";
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
  it("renders today and recurring sections", async () => {
    await addTask({ title: "买啤酒" });
    await addTask({ title: "跑步", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const { host, root } = await renderPage();

    await waitForText(host, "买啤酒");

    expect(host.textContent).toContain("跑步");
    expect(host.textContent).toContain("重复任务");
    expect(host.textContent).toContain("今天");
    expect(host.textContent).toContain("收件箱");
    await act(async () => root.unmount());
  });

  it("adds a task to today via input", async () => {
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

  it("inbox task goes to inbox section", async () => {
    await addTask({ title: "稍后处理", toInbox: true });
    const { host, root } = await renderPage();

    await waitForText(host, "稍后处理");
    expect(host.textContent).toContain("收件箱");
    await act(async () => root.unmount());
  });

  it("重复任务行不显示完成进度", async () => {
    await db.tasks.add({
      id: "p1",
      title: "做三次",
      done: false,
      recurrence: { freq: "daily", interval: 1, basis: "due", count: 3 },
      lastDoneAt: null,
      startAt: "2026-06-01T00:00:00.000Z",
      scheduledAt: null,
      subtasks: [],
      sortOrder: 0,
      completedCount: 1,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    const { host, root } = await renderPage();

    await waitForText(host, "做三次");
    expect(host.textContent).not.toContain("完成 1/3");
    expect(host.querySelector('input[aria-label="完成 做三次"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("点任务行打开详情抽屉", async () => {
    await addTask({ title: "点我打开" });
    const { host, root } = await renderPage();
    await waitForText(host, "点我打开");

    const row = Array.from(host.querySelectorAll('[role="button"]')).find((el) =>
      el.textContent?.includes("点我打开"),
    ) as HTMLElement;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });

    const sheet = host.querySelector('[role="dialog"][aria-label="任务详情"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.querySelector('input[aria-label="任务标题"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("顶部表单不再进入编辑态（无保存/取消按钮）", async () => {
    await addTask({ title: "某任务" });
    const { host, root } = await renderPage();
    await waitForText(host, "某任务");

    const row = Array.from(host.querySelectorAll('[role="button"]')).find((el) =>
      el.textContent?.includes("某任务"),
    ) as HTMLElement;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });

    const addInput = host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement;
    expect(addInput.value).toBe("");
    const buttons = Array.from(host.querySelectorAll("form button")).map((b) => b.textContent);
    expect(buttons).not.toContain("保存");
    expect(buttons).not.toContain("取消");
    await act(async () => root.unmount());
  });

  it("列表行只显示复选框与名称，不显示时间/计数", async () => {
    const t = await addTask({ title: "今天任务" });
    await updateSubtasks(t.id, [{ id: "s1", title: "子", done: false }]);
    const { host, root } = await renderPage();
    await waitForText(host, "今天任务");
    const row = [...host.querySelectorAll('[role="button"]')].find((el) => el.textContent?.includes("今天任务"))!;
    expect(row.textContent).toContain("今天任务");
    expect(row.textContent).not.toContain("创建于");
    expect(row.textContent).not.toContain("0/1");
    expect(host.querySelector('input[aria-label="完成 今天任务"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
