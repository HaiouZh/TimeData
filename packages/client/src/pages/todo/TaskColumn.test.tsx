// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "@timedata/shared";
import { db } from "../../db/index.js";
import { addTask, createChildTask } from "../../lib/tasks.js";
import { TaskColumn } from "./TaskColumn.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  await db.tasks.clear();
  await db.syncLog.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,    completedCount: 0,
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

  it("sortable today 列渲染左侧拖拽抓取区，非 sortable 不渲染", async () => {
    const plain = await render(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [task({ title: "A" })], emptyText: "空", ...handlers }),
    );
    expect(plain.host.querySelector('[aria-label="拖动 A"]')).toBeNull();
    expect(plain.host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
    await act(async () => plain.root.unmount());

    const sortable = await render(
      createElement(TaskColumn, {
        title: "今天",
        pool: "today",
        tasks: [task({ title: "A" })],
        emptyText: "空",
        sortable: true,
        containerId: "pool:today",
        ...handlers,
      }),
    );
    expect(sortable.host.querySelector('[aria-label="拖动 A"]')).toBeNull();
    expect(sortable.host.querySelector('[data-testid="task-row-grab-area"]')).not.toBeNull();
    await act(async () => sortable.root.unmount());
  });

  it("展开 root 行后 children 可勾选（child 直接落库）", async () => {
    const parent = await addTask({ title: "父", toInbox: true });
    const child = await createChildTask(parent.id, "子");
    const fresh = (await db.tasks.get(parent.id))!;

    const { host, root } = await render(
      createElement(TaskColumn, {
        title: "收件箱",
        pool: "inbox",
        tasks: [fresh],
        emptyText: "空",
        ...handlers,
      }),
    );
    await settle();

    const row = host.querySelector('[aria-label="打开 父"]') as HTMLElement;
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));
    await settle();
    await settle();
    await act(async () =>
      host.querySelector('input[aria-label="完成子任务 子"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await settle();

    const after = await db.tasks.get(child.id);
    expect(after?.done).toBe(true);
    await act(async () => root.unmount());
  });
});
