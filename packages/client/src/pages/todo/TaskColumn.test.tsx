// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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
const handlers = { onToggle: noop, onEdit: noop, onDelete: noop, onToToday: noop, onToInbox: noop, onSubtasksChange: noop };

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

  it("sortable today 列渲染拖拽手柄，非 sortable 不渲染", async () => {
    const plain = await render(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [task({ title: "A" })], emptyText: "空", ...handlers }),
    );
    expect(plain.host.querySelector('[aria-label="拖动 A"]')).toBeNull();
    await act(async () => plain.root.unmount());

    const sortable = await render(
      createElement(TaskColumn, {
        title: "今天",
        pool: "today",
        tasks: [task({ title: "A" })],
        emptyText: "空",
        sortable: true,
        ...handlers,
      }),
    );
    expect(sortable.host.querySelector('[aria-label="拖动 A"]')).not.toBeNull();
    await act(async () => sortable.root.unmount());
  });

  it("透传 onSubtasksChange 给行（展开勾选子任务时触发）", async () => {
    const onSubtasksChange = vi.fn();
    const tasks = [task({ id: "t1", title: "父", subtasks: [{ id: "s1", title: "子", done: false }] })];
    const { host, root } = await render(
      createElement(TaskColumn, {
        title: "收件箱",
        pool: "inbox",
        tasks,
        emptyText: "空",
        ...handlers,
        onSubtasksChange,
      }),
    );

    const row = host.querySelector('[aria-label="打开 父"]') as HTMLElement;
    // jsdom 下 BCR 默认全 0，需要给一个非零宽度才能让行 onClick + rowClickZone 进入 expand 分支。
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));
    await act(async () =>
      host.querySelector('input[aria-label="完成子任务 子"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(onSubtasksChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1" }),
      [{ id: "s1", title: "子", done: true }],
    );
    await act(async () => root.unmount());
  });
});
