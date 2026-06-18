// @vitest-environment jsdom

import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskRow } from "./TaskRow.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 兜底清理：portal/popover 测试若异常路径未 unmount 会污染下一条 document.body 查询。
afterEach(() => {
  document.body.innerHTML = "";
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
    subtasks: [],
    completedCount: 0,
    turn: null,
    turnAt: null,
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
  onSubtasksChange: noop,
  onTurnChange: noop,
};

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe("TaskRow", () => {
  // 88bc8ed 起统一靠 swipe + 详情抽屉操作，TaskRow 行内不再渲染任何 hover-action 按钮。
  // 用一条聚合 sanity 钉住这件事，避免下次有人误回归；其它分散 toBeNull 不重复列。
  const NO_INLINE_ACTION_LABELS = [
    "排进今天",
    "回收件箱",
    "删除",
    "纳入回合",
    "切换回合",
    "编辑重复与时间",
    "计划到某天",
    "添加子任务",
  ];

  it("普通任务：复选框 + 标题 + 文本可选区；无行内 hover-action 按钮", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ title: "买啤酒" }), pool: "today", ...handlers }),
    );
    expect(host.querySelector('input[aria-label="完成 买啤酒"]')).not.toBeNull();
    expect(host.textContent).toContain("买啤酒");
    expect(host.querySelector('[role="button"]')).toBeNull();
    expect(host.querySelector(".select-text")).not.toBeNull();
    for (const label of NO_INLINE_ACTION_LABELS) {
      expect(host.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }
    await act(async () => root.unmount());
  });

  it("有子任务渲染非交互折叠指示器与 m/n；无子任务不渲染槽位", async () => {
    const withSub = await render(
      createElement(TaskRow, {
        task: task({
          subtasks: [
            { id: "s1", title: "子1", done: true },
            { id: "s2", title: "子2", done: false },
          ],
        }),
        pool: "inbox",
        ...handlers,
      }),
    );
    const caret = withSub.host.querySelector('[data-testid="subtask-caret"]') as HTMLElement | null;
    expect(caret).not.toBeNull();
    // caret 是 <span> 而非 <button>，即覆盖"无展开/收起子任务按钮"语义，不再单独列 toBeNull。
    expect(caret?.tagName.toLowerCase()).toBe("span");
    expect(withSub.host.textContent).toContain("1/2");
    await act(async () => withSub.root.unmount());

    const noSub = await render(createElement(TaskRow, { task: task(), pool: "inbox", ...handlers }));
    expect(noSub.host.querySelector('[data-testid="subtask-caret"]')).toBeNull();
    await act(async () => noSub.root.unmount());
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
    expect(host.textContent).toContain("逾期 6月16日");
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
    expect(host.textContent).toContain("6/20");
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
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ subtasks: [{ id: "s1", title: "子任务甲", done: false }] }),
        pool: "inbox",
        ...handlers,
        onEdit,
      }),
    );
    const row = host.querySelector('[aria-label^="打开"]') as HTMLElement;
    // jsdom 下 getBoundingClientRect 默认返回全 0，rowClickZone 会因 width=0 退化成 open。
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    expect(field?.value).toBe("子任务甲");
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

  it("勾选内联子任务调 onSubtasksChange、不调 onToggle", async () => {
    const onSubtasksChange = vi.fn();
    const onToggle = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ subtasks: [{ id: "s1", title: "子甲", done: false }] }),
        pool: "inbox",
        ...handlers,
        onSubtasksChange,
        onToggle,
      }),
    );

    const row = host.querySelector('[aria-label^="打开"]') as HTMLElement;
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));
    await act(async () =>
      host
        .querySelector('input[aria-label="完成子任务 子甲"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(onSubtasksChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), [
      { id: "s1", title: "子甲", done: true },
    ]);
    expect(onToggle).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("传 dragHandle 时渲染拖拽手柄，不传则无", async () => {
    const noHandle = await render(createElement(TaskRow, { task: task({ title: "X" }), pool: "today", ...handlers }));
    expect(noHandle.host.querySelector('[aria-label="拖动 X"]')).toBeNull();
    await act(async () => noHandle.root.unmount());

    const handle = { setActivatorNodeRef: () => {}, attributes: {}, listeners: {} };
    const withHandle = await render(
      createElement(TaskRow, { task: task({ title: "X" }), pool: "today", ...handlers, dragHandle: handle }),
    );
    expect(withHandle.host.querySelector('[aria-label="拖动 X"]')).not.toBeNull();
    await act(async () => withHandle.root.unmount());
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

  it("turn 徽章按 turn 取色取字，turn=null 不显示", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ turn: "me" }), pool: "today", ...handlers }),
    );
    const badge = host.querySelector('[data-testid="turn-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-turn")).toBe("me");
    expect(badge?.textContent).toContain("等我");
    await act(async () => root.unmount());
  });

  it("tag chip 展示在 meta 带，无 tag 不显示", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ tags: ["重构", "bug"] }), pool: "today", ...handlers }),
    );
    const chips = host.querySelectorAll('[data-testid="tag-chip"]');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain("重构");
    expect(host.querySelector('[data-testid="turn-badge"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("普通池行徽章不可点（无 onClick 触发 onTurnChange）", async () => {
    const onTurnChange = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ turn: "me" }), pool: "today", ...handlers, onTurnChange }),
    );
    const badge = host.querySelector('[data-testid="turn-badge"]') as HTMLElement;
    await act(async () => badge.click());
    expect(onTurnChange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("turnBadgeInteractive=true 行徽章点击调 onTurnChange", async () => {
    const onTurnChange = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ turn: "me" }),
        pool: "today",
        turnBadgeInteractive: true,
        ...handlers,
        onTurnChange,
      }),
    );
    const badge = host.querySelector('[data-testid="turn-badge"]') as HTMLElement;
    await act(async () => badge.click());
    expect(onTurnChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "me");
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

  it.each([
    ["me", "等我"],
    ["running", "在跑"],
    ["parked", "搁置"],
  ] as const)("turn=%s 徽章 data-turn=%s 文案=%s", async (turn, label) => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ turn }), pool: "today", ...handlers }),
    );
    const badge = host.querySelector('[data-testid="turn-badge"]');
    expect(badge?.getAttribute("data-turn")).toBe(turn);
    expect(badge?.textContent).toContain(label);
    await act(async () => root.unmount());
  });
});