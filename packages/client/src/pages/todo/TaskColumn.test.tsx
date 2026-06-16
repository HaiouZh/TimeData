// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Task } from "@timedata/shared";
import { TaskColumn } from "./TaskColumn.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    subtasks: [],
    completedCount: 0,
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = () => {};
const handlers = { onToggle: noop, onEdit: noop, onDelete: noop, onToToday: noop, onToInbox: noop };

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe("TaskColumn swipe 接线", () => {
  it("today 列：有回收件箱 + 删除，无排进今天", async () => {
    const { host, root } = await render(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [task()], emptyText: "空", ...handlers }),
    );
    expect(host.textContent).toContain("回收件箱");
    expect(host.textContent).toContain("删除");
    expect(host.textContent).not.toContain("排进今天");
    await act(async () => root.unmount());
  });

  it("inbox 列：有排进今天 + 删除，无回收件箱", async () => {
    const { host, root } = await render(
      createElement(TaskColumn, { title: "收件箱", pool: "inbox", tasks: [task()], emptyText: "空", ...handlers }),
    );
    expect(host.textContent).toContain("排进今天");
    expect(host.textContent).toContain("删除");
    expect(host.textContent).not.toContain("回收件箱");
    await act(async () => root.unmount());
  });

  it("重复任务在 today 列无移动动作", async () => {
    const recurring = task({ recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const { host, root } = await render(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [recurring], emptyText: "空", ...handlers }),
    );
    expect(host.textContent).not.toContain("回收件箱");
    expect(host.textContent).not.toContain("排进今天");
    await act(async () => root.unmount());
  });

  it("使用语义 token，不再带裸 slate/rose/sky 色类", async () => {
    const { host, root } = await render(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [task()], emptyText: "空", ...handlers }),
    );
    expect(host.innerHTML).toContain("bg-surface");
    expect(host.innerHTML).toContain("text-ink");
    expect(host.innerHTML).not.toMatch(/(?:slate|rose|sky|amber)-/);
    await act(async () => root.unmount());
  });
});
