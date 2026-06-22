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
import { addTask, scheduleTask, setTaskTags, toggleTaskDone } from "../lib/tasks.js";
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

  // 回归：收件箱行的「排进今天」(→) 把任务排进今天。曾因 moveToToday 传 localDateOf(ISO)
  // 给 scheduleTask（期望 "YYYY-MM-DD"），normalizeScheduledDate 解析出 NaN → Invalid time value
  // 抛错且未捕获，任务原地不动（用户报「点了没反应」）。
  it("点收件箱行「排进今天」→ 任务移入今天且 scheduledAt 落库", async () => {
    await addTask({ title: "收件箱条目", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "收件箱条目");

    const btn = host.querySelector('[aria-label="排进今天 收件箱条目"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 等 dexie liveQuery → 重渲染把任务从收件箱挪到今天分区。
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1000) {
      const today = host.querySelector('[data-section="today"]') as HTMLElement | null;
      if (today?.textContent?.includes("收件箱条目")) break;
      await act(async () => {
        await new Promise((r) => window.setTimeout(r, 0));
      });
    }

    const tasks = await db.tasks.toArray();
    expect(tasks[0]?.scheduledAt).not.toBeNull();
    const todaySection = host.querySelector('[data-section="today"]') as HTMLElement | null;
    expect(todaySection?.textContent ?? "").toContain("收件箱条目");
    const inboxSection = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSection?.textContent ?? "").not.toContain("收件箱条目");
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

  it("待办页不再渲染旧 parent drop zone", async () => {
    await addTask({ title: "父" });
    const { host, root } = await renderPage();
    await waitForText(host, "父");

    expect(host.querySelector('[data-testid="parent-drop-zone"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("root 行渲染左侧拖拽抓取区", async () => {
    await addTask({ title: "可拖任务" });
    const { host, root } = await renderPage();
    await waitForText(host, "可拖任务");

    expect(host.querySelector('[data-testid="task-row-grab-area"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("不再渲染注意力区", async () => {
    await addTask({ title: "普通任务", toInbox: true });

    const { host, root } = await renderPage();
    await waitForText(host, "普通任务");

    expect(host.querySelector('[data-testid="attention-queue"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("tag 筛选作用于普通任务池", async () => {
    const a = await addTask({ title: "任务 A", toInbox: true });
    await setTaskTags(a.id, ["x"]);
    const b = await addTask({ title: "普通任务 B", toInbox: true });
    await setTaskTags(b.id, ["y"]);

    const { host, root } = await renderPage();
    await waitForText(host, "任务 A");
    await waitForText(host, "普通任务 B");

    await act(async () => (host.querySelector('[aria-label="展开标签筛选"]') as HTMLButtonElement).click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });

    const filterY = host.querySelector('[aria-label="筛选 y"]') as HTMLButtonElement;
    expect(filterY).not.toBeNull();
    await act(async () => filterY.click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    const inboxSectionAfterY = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSectionAfterY?.textContent ?? "").not.toContain("任务 A");
    expect(inboxSectionAfterY?.textContent ?? "").toContain("普通任务 B");

    await act(async () => filterY.click());
    const filterX = host.querySelector('[aria-label="筛选 x"]') as HTMLButtonElement;
    await act(async () => filterX.click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    const inboxSection = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSection?.textContent ?? "").toContain("任务 A");
    expect(inboxSection?.textContent ?? "").not.toContain("普通任务 B");

    await act(async () => root.unmount());
  });

  it("选含标签→收面板→搜索：标签上下文与关键词叠加（搜索 ∩ 标签）", async () => {
    const a = await addTask({ title: "写工作报告", toInbox: true });
    await setTaskTags(a.id, ["工作"]);
    const b = await addTask({ title: "工作杂事", toInbox: true });
    await setTaskTags(b.id, ["工作"]);
    const c = await addTask({ title: "生活报告", toInbox: true });
    await setTaskTags(c.id, ["生活"]);

    const { host, root } = await renderPage();
    await waitForText(host, "写工作报告");

    const clickEl = async (sel: string) => {
      await act(async () => (host.querySelector(sel) as HTMLButtonElement).click());
      await act(async () => {
        await new Promise((r) => window.setTimeout(r, 0));
      });
    };
    await clickEl('[aria-label="展开标签筛选"]');
    await clickEl('[aria-label="筛选 工作"]');
    await clickEl('[aria-label="收起标签筛选"]');

    const inputEl = host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(inputEl, "报告");
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    expect(inbox.textContent ?? "").toContain("写工作报告");
    expect(inbox.textContent ?? "").not.toContain("工作杂事");
    expect(inbox.textContent ?? "").not.toContain("生活报告");
    await act(async () => root.unmount());
  });
});
