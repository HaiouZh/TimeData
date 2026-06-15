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

function clickRepeatToggle(host: HTMLElement): Promise<void> {
  const toggle = Array.from(host.querySelectorAll("button")).find((b) =>
    b.getAttribute("aria-label")?.startsWith("Repeat"),
  ) as HTMLButtonElement;
  return act(async () => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("TodoPage", () => {
  it("renders today and Repeat/InBox bar", async () => {
    await addTask({ title: "买啤酒" });
    await addTask({ title: "跑步", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const { host, root } = await renderPage();

    await waitForText(host, "买啤酒");

    expect(host.textContent).toContain("今天");
    expect(host.textContent).toContain("Repeat");
    expect(host.textContent).toContain("InBox");
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

  it("移除收纳按钮，默认提交进今天", async () => {
    const { host, root } = await renderPage();
    const buttons = Array.from(host.querySelectorAll("form button")).map((b) => b.textContent);
    expect(buttons).not.toContain("收纳");

    const input = host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement;
    const form = host.querySelector("form");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "默认今天");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await waitForText(host, "默认今天");

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].recurrence).toBeNull();
    expect(tasks[0].scheduledAt).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("勾选重复后展开重复配置行", async () => {
    const { host, root } = await renderPage();
    expect(host.textContent).not.toContain("频率");

    const repeat = host.querySelector('input[aria-label="重复"]') as HTMLInputElement;
    await act(async () => {
      repeat.click();
    });
    expect(host.textContent).toContain("频率");
    expect(host.textContent).toContain("每天");
    await act(async () => root.unmount());
  });

  it("默认展开 InBox，点击 Repeat 在 InBox 上方展开", async () => {
    await addTask({ title: "收件箱项", toInbox: true });
    await addTask({ title: "每日重复", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const { host, root } = await renderPage();
    await waitForText(host, "收件箱项");

    expect(host.textContent).toContain("收件箱项");
    const repeatList = () =>
      Array.from(host.querySelectorAll('[data-panel="repeat"]')).some((el) => el.textContent?.includes("每日重复"));
    expect(repeatList()).toBe(false);

    await clickRepeatToggle(host);
    expect(repeatList()).toBe(true);

    const repeatNode = host.querySelector('[data-panel="repeat"]');
    const inboxNode = host.querySelector('[data-panel="inbox"]');
    expect(repeatNode && inboxNode && (repeatNode.compareDocumentPosition(inboxNode) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("inbox task goes to InBox panel", async () => {
    await addTask({ title: "稍后处理", toInbox: true });
    const { host, root } = await renderPage();

    await waitForText(host, "稍后处理");
    expect(host.textContent).toContain("InBox");
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
    await clickRepeatToggle(host);

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

  it("composer 不进入编辑态（无保存/取消按钮）", async () => {
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
