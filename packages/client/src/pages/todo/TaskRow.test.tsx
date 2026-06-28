// @vitest-environment jsdom

import "fake-indexeddb/auto";
import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { addTask, createChildTask, toggleTaskDone } from "../../lib/tasks.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TaskRow } from "./TaskRow.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 兜底清理：portal/popover 测试若异常路径未 unmount 会污染下一条 document.body 查询。
afterEach(() => {
  document.body.innerHTML = "";
});

beforeEach(async () => {
  await db.tasks.clear();
  await db.syncLog.clear();
});

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = () => {};
const handlers = {
  onToggle: noop,
  onEdit: noop,
  onDelete: noop,
};

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe("TaskRow", () => {
  // 默认不渲染桌面 overlay：只有 TaskList 明确传 coarsePointer=false 时才开启桌面入口。
  // 用一条聚合 sanity 钉住兼容性；其它分散 toBeNull 不重复列。
  const NO_INLINE_ACTION_LABELS = ["排进今天", "回收件箱", "删除", "编辑重复与时间", "计划到某天", "添加子任务"];

  it("普通任务：复选框 + 标题 + 文本可选区；无行内 hover-action 按钮", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ title: "买啤酒" }), pool: "today", ...handlers }),
    );
    expect(host.querySelector('input[aria-label="完成 买啤酒"]')).not.toBeNull();
    expect(host.textContent).toContain("买啤酒");
    expect(host.querySelector('[role="button"]')).toBeNull();
    expect(host.querySelector(".select-text")).not.toBeNull();
    for (const label of NO_INLINE_ACTION_LABELS) {
      expect(host.querySelector(`[aria-label^="${label}"]`)).toBeNull();
    }
    await act(async () => root.unmount());
  });

  it("有子任务渲染非交互折叠指示器与 m/n；无子任务不渲染槽位", async () => {
    const parent = await addTask({ title: "父" });
    await createChildTask(parent.id, "子1");
    const c2 = await createChildTask(parent.id, "子2");
    await toggleTaskDone(c2.id);
    const fresh = (await db.tasks.get(parent.id))!;

    const withSub = await render(createElement(TaskRow, { task: fresh, pool: "inbox", ...handlers }));
    await settle();
    const caret = withSub.host.querySelector('[data-testid="subtask-caret"]') as HTMLElement | null;
    expect(caret).not.toBeNull();
    // caret 是 <span> 而非 <button>，覆盖"无展开/收起子任务按钮"语义。
    expect(caret?.tagName.toLowerCase()).toBe("span");
    expect(withSub.host.textContent).toContain("1/2");
    await act(async () => withSub.root.unmount());

    const noSub = await render(createElement(TaskRow, { task: task(), pool: "inbox", ...handlers }));
    await settle();
    expect(noSub.host.querySelector('[data-testid="subtask-caret"]')).toBeNull();
    await act(async () => noSub.root.unmount());
  });

  it("不再渲染旧 parent drop zone", async () => {
    const { host, root } = await renderDom(
      <TaskRow task={task({ title: "父" })} pool="today" onToggle={noop} onEdit={noop} />,
    );

    expect(host.querySelector('[data-testid="parent-drop-zone"]')).toBeNull();
    await unmount(root);
  });

  it("逾期重复任务在第二行显示红色逾期日期（M月D日）", async () => {
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({
          recurrence: { freq: "daily", interval: 1, basis: "due" },
          lastDoneAt: "2026-06-15T12:00:00.000Z",
          startAt: "2026-06-01T12:00:00.000Z",
        }),
        pool: "today",
        overdue: true,
        ...handlers,
      }),
    );
    expect(host.textContent).toContain("6月16日");
    await act(async () => root.unmount());
  });

  it("已排期一次性任务行显示被动日期摘要", async () => {
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ scheduledAt: "2026-06-20T00:00:00.000Z" }),
        pool: "upcoming",
        ...handlers,
      }),
    );
    expect(host.textContent).toContain("6月20日");
    await act(async () => root.unmount());
  });

  it("已排期重复任务行显示重复摘要而非日期", async () => {
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({
          recurrence: { freq: "daily", interval: 1, basis: "due" },
          startAt: "2099-12-31T00:00:00.000Z",
        }),
        pool: "upcoming",
        ...handlers,
      }),
    );
    expect(host.textContent).toContain("每天");
    await act(async () => root.unmount());
  });

  it("已排期重复任务行：复选框不勾选、标题不划线", async () => {
    const r = task({
      title: "刮胡子",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      lastDoneAt: null,
      startAt: "2099-12-31T00:00:00.000Z",
    });
    const { host, root } = await render(createElement(TaskRow, { task: r, pool: "upcoming", ...handlers }));
    const cb = host.querySelector('input[aria-label="完成 刮胡子"]') as HTMLInputElement | null;
    expect(cb?.checked).toBe(false);
    expect(host.querySelector(".line-through")).toBeNull();
    await act(async () => root.unmount());
  });

  it("点行（无子任务）触发 onEdit", async () => {
    const onEdit = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ title: "点我" }), pool: "inbox", ...handlers, onEdit }),
    );
    const row = host.querySelector('[aria-label="打开 点我"]')!;
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("点 caret（在行左 2/5 命中区）经行 onClick 仍展开，不调 onEdit", async () => {
    const onEdit = vi.fn();
    const parent = await addTask({ title: "父" });
    await createChildTask(parent.id, "子任务甲");
    const fresh = (await db.tasks.get(parent.id))!;

    const { host, root } = await render(createElement(TaskRow, { task: fresh, pool: "inbox", ...handlers, onEdit }));
    await settle();
    const row = host.querySelector('[aria-label^="打开"]') as HTMLElement;
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));
    await settle();
    const title = host.querySelector('[data-testid^="child-title-"]') as HTMLElement | null;
    expect(title?.textContent).toBe("子任务甲");
    expect(host.querySelector('textarea[aria-label="子任务标题"]')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("有选区时点行不开抽屉", async () => {
    const onEdit = vi.fn();
    const original = window.getSelection;
    window.getSelection = () => ({ toString: () => "选中的文字" }) as Selection;
    try {
      const { host, root } = await render(
        createElement(TaskRow, { task: task({ title: "点我" }), pool: "inbox", ...handlers, onEdit }),
      );
      const row = host.querySelector('[aria-label="打开 点我"]')!;
      await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(onEdit).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    } finally {
      window.getSelection = original;
    }
  });

  it("勾选子任务直接落库（child 走非重复 toggleTaskDone 路径），不调父行 onToggle", async () => {
    const onToggle = vi.fn();
    const parent = await addTask({ title: "父" });
    const child = await createChildTask(parent.id, "子甲");
    const fresh = (await db.tasks.get(parent.id))!;

    const { host, root } = await render(createElement(TaskRow, { task: fresh, pool: "inbox", ...handlers, onToggle }));
    await settle();

    const row = host.querySelector('[aria-label^="打开"]') as HTMLElement;
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));
    await settle();
    await act(async () =>
      host
        .querySelector('input[aria-label="完成子任务 子甲"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await settle();

    const after = await db.tasks.get(child.id);
    expect(after?.done).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("传 dragHandle 时不再渲染右侧独立拖柄,而是渲染左 2/5 抓取区", async () => {
    const noHandle = await render(createElement(TaskRow, { task: task({ title: "X" }), pool: "today", ...handlers }));
    expect(noHandle.host.querySelector('[aria-label="拖动 X"]')).toBeNull();
    expect(noHandle.host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
    await act(async () => noHandle.root.unmount());

    const handle = { setActivatorNodeRef: vi.fn(), attributes: {}, listeners: {} };
    const withHandle = await render(
      createElement(TaskRow, { task: task({ title: "X" }), pool: "today", ...handlers, dragHandle: handle }),
    );
    expect(withHandle.host.querySelector('[aria-label="拖动 X"]')).toBeNull();
    expect(withHandle.host.querySelector('[data-testid="task-row-grab-area"]')).not.toBeNull();
    expect(handle.setActivatorNodeRef).toHaveBeenCalled();
    await act(async () => withHandle.root.unmount());
  });

  it("点左 2/5 抓取区:有子任务时展开,不打开详情", async () => {
    const onEdit = vi.fn();
    const parent = await addTask({ title: "父" });
    await createChildTask(parent.id, "子任务甲");
    const fresh = (await db.tasks.get(parent.id))!;
    const handle = { setActivatorNodeRef: vi.fn(), attributes: {}, listeners: {} };

    const { host, root } = await renderDom(
      <TaskRow task={fresh} pool="today" onToggle={noop} onEdit={onEdit} dragHandle={handle} />,
    );
    await settle();
    await click(host.querySelector('[data-testid="task-row-grab-area"]'));
    await settle();

    const title = host.querySelector('[data-testid^="child-title-"]') as HTMLElement | null;
    expect(title?.textContent).toBe("子任务甲");
    expect(host.querySelector('textarea[aria-label="子任务标题"]')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("点左 2/5 抓取区:无子任务时打开详情", async () => {
    const onEdit = vi.fn();
    const handle = { setActivatorNodeRef: vi.fn(), attributes: {}, listeners: {} };
    const rowTask = task({ title: "X" });
    const { host, root } = await renderDom(
      <TaskRow task={rowTask} pool="today" onToggle={noop} onEdit={onEdit} dragHandle={handle} />,
    );

    await click(host.querySelector('[data-testid="task-row-grab-area"]'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: rowTask.id }));
    await unmount(root);
  });

  it("点复选框仍只触发 onToggle", async () => {
    const onToggle = vi.fn();
    const onEdit = vi.fn();
    const handle = { setActivatorNodeRef: vi.fn(), attributes: {}, listeners: {} };
    const { host, root } = await renderDom(
      <TaskRow task={task({ title: "X" })} pool="today" onToggle={onToggle} onEdit={onEdit} dragHandle={handle} />,
    );

    await click(host.querySelector('input[aria-label="完成 X"]'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("重复任务：第二行显示重复图标", async () => {
    const r = task({
      title: "刮胡子",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-06-01T00:00:00.000Z",
    });
    const { host, root } = await render(createElement(TaskRow, { task: r, pool: "recurring", ...handlers }));
    expect(host.querySelector('[data-icon="repeat"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("不渲染旧状态徽章", async () => {
    const legacyStateField = "tu" + "rn";
    const legacyBadgeId = `${legacyStateField}-badge`;
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ [legacyStateField]: "me" } as Partial<Task>), pool: "today", ...handlers }),
    );

    expect(host.querySelector(`[data-testid="${legacyBadgeId}"]`)).toBeNull();
    expect(host.textContent).not.toContain("等我");
    await act(async () => root.unmount());
  });

  it("tag chip 展示在 meta 带，无 tag 不显示", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ tags: ["重构", "bug"] }), pool: "today", ...handlers }),
    );
    const chips = host.querySelectorAll('[data-testid="tag-chip"]');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain("重构");
    await act(async () => root.unmount());
  });

  it("tag chip 超过 3 个截断显示 …", async () => {
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ tags: ["a", "b", "c", "d", "e"] }),
        pool: "today",
        ...handlers,
      }),
    );
    const chips = host.querySelectorAll('[data-testid="tag-chip"]');
    expect(chips.length).toBe(3);
    expect(host.textContent).toContain("…");
    await act(async () => root.unmount());
  });

  it("tag 数量正好 3 个不显示 …", async () => {
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ tags: ["a", "b", "c"] }),
        pool: "today",
        ...handlers,
      }),
    );
    expect(host.querySelectorAll('[data-testid="tag-chip"]').length).toBe(3);
    expect(host.textContent).not.toContain("…");
    await act(async () => root.unmount());
  });

  it("tag chip 内含确定性色点（inline backgroundColor）", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ tags: ["工作"] }), pool: "today", ...handlers }),
    );
    const chip = host.querySelector('[data-testid="tag-chip"]') as HTMLElement;
    const dot = chip.querySelector("[data-tag-dot]") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.backgroundColor).not.toBe("");

    const second = await render(
      createElement(TaskRow, { task: task({ id: "t2", tags: ["工作"] }), pool: "today", ...handlers }),
    );
    const dot2 = second.host.querySelector("[data-tag-dot]") as HTMLElement;
    expect(dot2.style.backgroundColor).toBe(dot.style.backgroundColor);
    await act(async () => root.unmount());
    await act(async () => second.root.unmount());
  });

  describe("桌面 overlay 动作", () => {
    it("桌面（细指针）+ today 池：显示「回收件箱」「删除」按钮并触发回调", async () => {
      const onToInbox = vi.fn();
      const onDelete = vi.fn();
      const { host, root } = await renderDom(
        <TaskRow
          task={task()}
          pool="today"
          coarsePointer={false}
          onToggle={noop}
          onEdit={noop}
          onDelete={onDelete}
          onToInbox={onToInbox}
        />,
      );

      const inboxButton = host.querySelector('[aria-label^="回收件箱"]');
      const deleteButton = host.querySelector('[aria-label^="删除"]');
      expect(inboxButton).not.toBeNull();
      expect(deleteButton).not.toBeNull();

      await click(inboxButton);
      await click(deleteButton);
      expect(onToInbox).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));

      await unmount(root);
    });

    it("桌面 + inbox 池：显示「排进今天」「删除」按钮", async () => {
      const { host, root } = await renderDom(
        <TaskRow
          task={task()}
          pool="inbox"
          coarsePointer={false}
          onToggle={noop}
          onEdit={noop}
          onDelete={noop}
          onToToday={noop}
        />,
      );

      expect(host.querySelector('[aria-label^="排进今天"]')).not.toBeNull();
      expect(host.querySelector('[aria-label^="删除"]')).not.toBeNull();

      await unmount(root);
    });

    it("桌面 + completed 池：只显示「删除」按钮", async () => {
      const { host, root } = await renderDom(
        <TaskRow
          task={task({ done: true })}
          pool="completed"
          coarsePointer={false}
          onToggle={noop}
          onEdit={noop}
          onDelete={noop}
        />,
      );

      expect(host.querySelector('[aria-label^="排进今天"]')).toBeNull();
      expect(host.querySelector('[aria-label^="回收件箱"]')).toBeNull();
      expect(host.querySelector('[aria-label^="删除"]')).not.toBeNull();

      await unmount(root);
    });

    it("移动端（粗指针）：overlay 按钮组完全不渲染", async () => {
      const { host, root } = await renderDom(
        <TaskRow
          task={task()}
          pool="today"
          coarsePointer={true}
          onToggle={noop}
          onEdit={noop}
          onDelete={noop}
          onToInbox={noop}
        />,
      );

      expect(host.querySelector('[aria-label^="回收件箱"]')).toBeNull();
      expect(host.querySelector('[aria-label^="删除"]')).toBeNull();

      await unmount(root);
    });

    it("点 overlay 按钮不触发行 onEdit", async () => {
      const onEdit = vi.fn();
      const onDelete = vi.fn();
      const { host, root } = await renderDom(
        <TaskRow
          task={task()}
          pool="today"
          coarsePointer={false}
          onToggle={noop}
          onEdit={onEdit}
          onDelete={onDelete}
          onToInbox={noop}
        />,
      );

      await click(host.querySelector('[aria-label^="删除"]'));
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();

      await unmount(root);
    });
  });

  describe("extraAction 插槽", () => {
    it("renders an extra action and stops row activation when clicked", async () => {
      const onEdit = vi.fn();
      const onExtra = vi.fn();
      const rowTask = task({ title: "水下想法" });
      const { host, root } = await renderDom(
        <TaskRow
          task={rowTask}
          pool="inbox"
          coarsePointer={false}
          onToggle={noop}
          onEdit={onEdit}
          extraAction={(item) => (
            <button
              type="button"
              aria-label={`顶一下 ${item.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onExtra(item.id);
              }}
            >
              ↑
            </button>
          )}
        />,
      );

      await click(host.querySelector<HTMLButtonElement>('button[aria-label="顶一下 水下想法"]'));

      expect(onExtra).toHaveBeenCalledWith(rowTask.id);
      expect(onEdit).not.toHaveBeenCalled();
      await unmount(root);
    });

    it("shows extra action on coarse pointers without hover", async () => {
      const rowTask = task({ title: "移动端想法" });
      const { host, root } = await renderDom(
        <TaskRow
          task={rowTask}
          pool="inbox"
          coarsePointer
          onToggle={noop}
          onEdit={noop}
          extraAction={(item) => <button type="button" aria-label={`顶一下 ${item.title}`} />}
        />,
      );

      expect(host.querySelector('button[aria-label="顶一下 移动端想法"]')).not.toBeNull();
      await unmount(root);
    });
  });
});
