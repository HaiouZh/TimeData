// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { db } from "../db/index.js";
import { setTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { addTask, scheduleTask, setTaskTags, setTaskTurn, toggleTaskDone } from "../lib/tasks.js";
import { TodoPage } from "./TodoPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  vi.unstubAllGlobals();
  await db.tasks.clear();
  await db.settings.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(BottomNavProvider, null, createElement(SyncProvider, null, createElement(TodoPage))),
      ),
    );
  });
  return { host, root };
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (host.textContent?.includes(text)) return;
    // setTimeout(0)：让位给 Dexie 异步与 React 渲染的宏任务边界，不是真实计时等待。
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
  }
  throw new Error(`Timed out waiting for ${text}`);
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
  it("渲染四分区：今天 / 已完成 / 收件箱 / 已排期，且不再出现旧分区名", async () => {
    const today = await addTask({ title: "今天事" });
    await addTask({ title: "稍后处理", toInbox: true });
    const future = await addTask({ title: "未来任务", toInbox: true });
    await scheduleTask(future.id, "2099-12-25");
    const doneOne = await addTask({ title: "完事了", toInbox: true });
    await toggleTaskDone(doneOne.id);

    const { host, root } = await renderPage();
    await waitForText(host, "今天事");

    expect(host.textContent).toContain("今天");
    expect(host.textContent).toContain("已完成");
    expect(host.textContent).toContain("收件箱");
    expect(host.textContent).toContain("已排期");
    // 旧分区名不应再出现。
    expect(host.textContent ?? "").not.toContain("即将到来");
    expect(host.textContent ?? "").not.toContain("重复 / 提醒");

    expect(host.querySelector('[data-section="today"]')).not.toBeNull();
    expect(host.querySelector('[data-section="inbox"]')).not.toBeNull();
    expect(today).toBeTruthy();
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

  it("点任务行打开详情抽屉", async () => {
    await addTask({ title: "点我打开" });
    const { host, root } = await renderPage();
    await waitForText(host, "点我打开");
    const row = host.querySelector('[aria-label="打开 点我打开"]')!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    expect(host.querySelector('[role="dialog"][aria-label="任务详情"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  // spec §4.3 硬约束零覆盖回归点：tag 筛选作用于下方各池，但**不**作用于顶部注意力区。
  // 构造场景：A 进注意力区（turn=me，tag=x），B 进普通池（tag=y）。点选筛 y → A 仍可见。
  it("tag 筛选不作用于注意力置顶区", async () => {
    const a = await addTask({ title: "等我处理 A", toInbox: true });
    await setTaskTurn(a.id, "me");
    await setTaskTags(a.id, ["x"]);
    const b = await addTask({ title: "普通任务 B", toInbox: true });
    await setTaskTags(b.id, ["y"]);

    const { host, root } = await renderPage();
    await waitForText(host, "等我处理 A");
    await waitForText(host, "普通任务 B");

    const queue = host.querySelector('[data-testid="attention-queue"]') as HTMLElement | null;
    expect(queue).not.toBeNull();
    expect(queue?.textContent).toContain("等我处理 A");

    const filterY = host.querySelector('[aria-label="筛选 y"]') as HTMLButtonElement;
    expect(filterY).not.toBeNull();
    await act(async () => filterY.click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    expect(host.querySelector('[data-testid="attention-queue"]')?.textContent).toContain("等我处理 A");

    await act(async () => filterY.click());
    const filterX = host.querySelector('[aria-label="筛选 x"]') as HTMLButtonElement;
    await act(async () => filterX.click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    expect(host.querySelector('[data-testid="attention-queue"]')?.textContent).toContain("等我处理 A");
    const inboxSection = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSection?.textContent ?? "").not.toContain("普通任务 B");

    await act(async () => root.unmount());
  });
});