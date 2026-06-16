// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { db } from "../db/index.js";
import { addTask } from "../lib/tasks.js";
import { setTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { TodoPage } from "./TodoPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await db.tasks.clear();
  await db.settings.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(TodoPage))));
  });
  return { host, root };
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (host.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 10));
    });
  }
  throw new Error(`Timed out waiting for ${text}`);
}

async function waitForDetailsWithText(host: HTMLElement, text: string): Promise<HTMLDetailsElement> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const details = [...host.querySelectorAll("details")].find((d) => d.textContent?.includes(text)) as
      | HTMLDetailsElement
      | undefined;
    if (details) return details;
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 10));
    });
  }
  throw new Error(`Timed out waiting for details ${text}`);
}

async function typeAndAdd(host: HTMLElement, title: string) {
  const input = host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement;
  const form = host.querySelector("form");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("TodoPage", () => {
  it("渲染今天与收件箱分区", async () => {
    await addTask({ title: "买啤酒" });
    await addTask({ title: "稍后处理", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买啤酒");
    expect(host.querySelector('[data-section="today"]')).not.toBeNull();
    expect(host.querySelector('[data-section="inbox"]')).not.toBeNull();
    expect(host.textContent).toContain("稍后处理");
    await act(async () => root.unmount());
  });

  it("默认落点=今天：添加进今天（scheduledAt 非空）", async () => {
    const { host, root } = await renderPage();
    await typeAndAdd(host, "默认今天");
    await waitForText(host, "默认今天");
    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].scheduledAt).not.toBeNull();
    expect(tasks[0].recurrence).toBeNull();
    await act(async () => root.unmount());
  });

  it("默认落点=收件箱：添加进收件箱（scheduledAt 为空）", async () => {
    await setTodoDefaultDestination("inbox");
    const { host, root } = await renderPage();
    await typeAndAdd(host, "丢收件箱");
    await waitForText(host, "丢收件箱");
    const tasks = await db.tasks.toArray();
    expect(tasks[0].scheduledAt).toBeNull();
    await act(async () => root.unmount());
  });

  it("点重复按钮打开预设门", async () => {
    const { host, root } = await renderPage();
    expect(host.querySelector('[aria-label="重复与时间"]')).toBeNull();
    const repeat = host.querySelector('button[aria-label="重复"]') as HTMLButtonElement;
    await act(async () => {
      repeat.click();
    });
    expect(host.querySelector('[aria-label="重复与时间"]')).not.toBeNull();
    expect(host.textContent).toContain("每天");
    await act(async () => root.unmount());
  });

  it("即将到来默认折叠收起", async () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const yyyy = future.getFullYear();
    const mm = String(future.getMonth() + 1).padStart(2, "0");
    const dd = String(future.getDate()).padStart(2, "0");
    const t = await addTask({ title: "未来任务" });
    const { scheduleTask } = await import("../lib/tasks.js");
    await scheduleTask(t.id, `${yyyy}-${mm}-${dd}`);
    const { host, root } = await renderPage();
    await waitForText(host, "即将到来");
    const details = [...host.querySelectorAll("details")].find((d) =>
      d.textContent?.includes("即将到来"),
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await act(async () => root.unmount());
  });

  it("逾期任务显示逾期标签", async () => {
    const t = await addTask({ title: "漏做的事" });
    const { scheduleTask } = await import("../lib/tasks.js");
    await scheduleTask(t.id, "2020-01-01");
    const { host, root } = await renderPage();
    await waitForText(host, "漏做的事");
    expect(host.textContent).toContain("逾期");
    await act(async () => root.unmount());
  });

  it("点任务行打开详情抽屉", async () => {
    await addTask({ title: "点我打开" });
    const { host, root } = await renderPage();
    await waitForText(host, "点我打开");
    const row = [...host.querySelectorAll('[role="button"]')].find((el) => el.textContent?.includes("点我打开"))!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    expect(host.querySelector('[role="dialog"][aria-label="任务详情"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("重复任务出现在重复折叠区且无完成计数", async () => {
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
    const details = await waitForDetailsWithText(host, "重复 / 提醒");
    await act(async () => {
      (details as HTMLDetailsElement).open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await waitForText(host, "做三次");
    expect(host.textContent).not.toContain("1/3");
    await act(async () => root.unmount());
  });
});
