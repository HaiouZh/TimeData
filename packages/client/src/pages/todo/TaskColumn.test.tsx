// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { addTask, createChildTask } from "../../lib/tasks.js";
import { db, resetDb } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { TaskColumn } from "./TaskColumn.js";

beforeEach(resetDb);

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
    scheduledAt: null,
    completedCount: 0,
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ruleId: null,
    skipped: false,
    ...overrides,
  };
}

const noop = () => {};
const handlers = { onToggle: noop, onEdit: noop, onDelete: noop, onToToday: noop, onToInbox: noop };

describe("TaskColumn swipe 接线", () => {
  it("today 列：有回收件箱 + 删除，无排进今天", async () => {
    const { host, root } = await renderDom(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [task()], emptyText: "空", ...handlers }),
    );
    expect(host.textContent).toContain("回收件箱");
    expect(host.textContent).toContain("删除");
    expect(host.textContent).not.toContain("排进今天");
    await unmount(root);
  });

  it("inbox 列：有排进今天 + 删除，无回收件箱", async () => {
    const { host, root } = await renderDom(
      createElement(TaskColumn, { title: "收件箱", pool: "inbox", tasks: [task()], emptyText: "空", ...handlers }),
    );
    expect(host.textContent).toContain("排进今天");
    expect(host.textContent).toContain("删除");
    expect(host.textContent).not.toContain("回收件箱");
    await unmount(root);
  });

  it("重复任务在 today 列无移动动作", async () => {
    const recurring = task({ recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const { host, root } = await renderDom(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [recurring], emptyText: "空", ...handlers }),
    );
    expect(host.textContent).not.toContain("回收件箱");
    expect(host.textContent).not.toContain("排进今天");
    await unmount(root);
  });

  it("使用语义 token，不再带裸 slate/rose/sky 色类", async () => {
    const { host, root } = await renderDom(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [task()], emptyText: "空", ...handlers }),
    );
    expect(host.innerHTML).toContain("bg-surface");
    expect(host.innerHTML).toContain("text-ink");
    expect(host.innerHTML).not.toMatch(/(?:slate|rose|sky|amber)-/);
    await unmount(root);
  });

  it("sortable today 列渲染左侧拖拽抓取区，非 sortable 不渲染", async () => {
    const plain = await renderDom(
      createElement(TaskColumn, {
        title: "今天",
        pool: "today",
        tasks: [task({ title: "A" })],
        emptyText: "空",
        ...handlers,
      }),
    );
    expect(plain.host.querySelector('[aria-label="拖动 A"]')).toBeNull();
    expect(plain.host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
    await unmount(plain.root);

    const sortable = await renderDom(
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
    await unmount(sortable.root);
  });

  it("展开 root 行后 children 可勾选（child 直接落库）", async () => {
    const parent = await addTask({ title: "父", toInbox: true });
    const child = await createChildTask(parent.id, "子");
    const fresh = (await db.tasks.get(parent.id))!;

    const { host, root } = await renderDom(
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
      host
        .querySelector('input[aria-label="完成子任务 子"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await settle();

    const after = await db.tasks.get(child.id);
    expect(after?.done).toBe(true);
    await unmount(root);
  });

  it("occurrence 在 today 列无移动动作，只保留删除", async () => {
    const occurrence = task({ id: "occ:r1:2026-06-14", ruleId: "r1", scheduledAt: "2026-06-14T00:00:00.000Z" });
    const { host, root } = await renderDom(
      createElement(TaskColumn, { title: "今天", pool: "today", tasks: [occurrence], emptyText: "空", ...handlers }),
    );
    expect(host.textContent).not.toContain("回收件箱");
    expect(host.textContent).not.toContain("排进今天");
    expect(host.textContent).toContain("删除");
    await unmount(root);
  });
});
