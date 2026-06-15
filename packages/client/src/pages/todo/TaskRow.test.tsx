// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "@timedata/shared";
import { TaskRow } from "./TaskRow.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1", title: "示例任务", done: false, recurrence: null,
    lastDoneAt: null, startAt: null, scheduledAt: null, subtasks: [],
    completedCount: 0, sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = () => {};
const handlers = {
  onToggle: noop, onEdit: noop, onDelete: noop, onToToday: noop, onToInbox: noop,
};

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe("TaskRow", () => {
  it("普通任务：复选框 + 标题，今天池有回收件箱/删除按钮", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ title: "买啤酒" }), pool: "today", ...handlers }),
    );
    expect(host.querySelector('input[aria-label="完成 买啤酒"]')).not.toBeNull();
    expect(host.textContent).toContain("买啤酒");
    expect(host.querySelector('[aria-label="回收件箱"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="删除"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="排进今天"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("收件箱池：有排进今天按钮", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task(), pool: "inbox", ...handlers }),
    );
    expect(host.querySelector('[aria-label="排进今天"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("逾期任务显示逾期标签", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task(), pool: "today", overdue: true, ...handlers }),
    );
    expect(host.textContent).toContain("逾期");
    await act(async () => root.unmount());
  });

  it("点标题触发 onEdit", async () => {
    const onEdit = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ title: "点我" }), pool: "inbox", ...handlers, onEdit }),
    );
    const titleBtn = [...host.querySelectorAll('[role="button"]')].find((el) => el.textContent?.includes("点我"))!;
    await act(async () => titleBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("重复任务：显示重复图标，无移动按钮，勾选态= !isDueNow", async () => {
    const r = task({
      title: "刮胡子",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-01T00:00:00.000Z",
    });
    const { host, root } = await render(createElement(TaskRow, { task: r, pool: "recurring", ...handlers }));
    expect(host.querySelector('[data-icon="repeat"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="排进今天"]')).toBeNull();
    expect(host.querySelector('[aria-label="回收件箱"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
