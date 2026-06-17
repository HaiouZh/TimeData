// @vitest-environment jsdom

import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TaskRow } from "./TaskRow.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  onToToday: noop,
  onToInbox: noop,
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
  it("普通任务：复选框 + 标题，无 role=button，标题可选中", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ title: "买啤酒" }), pool: "today", ...handlers }),
    );
    expect(host.querySelector('input[aria-label="完成 买啤酒"]')).not.toBeNull();
    expect(host.textContent).toContain("买啤酒");
    expect(host.querySelector('[role="button"]')).toBeNull();
    expect(host.querySelector(".select-text")).not.toBeNull();
    expect(host.querySelector('[aria-label="回收件箱"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="删除"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("无子任务不渲染展开箭头；有子任务渲染箭头与 m/n", async () => {
    const noSub = await render(createElement(TaskRow, { task: task(), pool: "inbox", ...handlers }));
    expect(noSub.host.querySelector('[aria-label="展开子任务"]')).toBeNull();
    await act(async () => noSub.root.unmount());

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
    expect(withSub.host.querySelector('[aria-label="展开子任务"]')).not.toBeNull();
    expect(withSub.host.textContent).toContain("1/2");
    await act(async () => withSub.root.unmount());
  });

  it("逾期任务在第二行显示红色逾期日期", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ scheduledAt: "2026-06-14" }), pool: "today", overdue: true, ...handlers }),
    );
    expect(host.textContent).toContain("逾期 6/14");
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

  it("点展开箭头显示可编辑子任务（textarea），不开抽屉", async () => {
    const onEdit = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ subtasks: [{ id: "s1", title: "子任务甲", done: false }] }),
        pool: "inbox",
        ...handlers,
        onEdit,
      }),
    );
    const caret = host.querySelector('[aria-label="展开子任务"]')!;
    await act(async () => caret.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    expect(field.value).toBe("子任务甲");
    expect(onEdit).not.toHaveBeenCalled();
    await act(async () => root.unmount());
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

    await act(async () =>
      host.querySelector('[aria-label="展开子任务"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
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

  it("零子任务：有添加子任务按钮；点它展开出可编辑空行", async () => {
    const { host, root } = await render(
      createElement(TaskRow, { task: task({ title: "空任务", subtasks: [] }), pool: "inbox", ...handlers }),
    );

    const add = host.querySelector('[aria-label="添加子任务"]') as HTMLButtonElement;
    expect(add).not.toBeNull();
    await act(async () => add.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    expect(field).not.toBeNull();
    expect(field.value).toBe("");
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

  it("重复任务：第二行显示重复图标，无移动按钮", async () => {
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

  it("窄屏不渲染日期 chip", async () => {
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ scheduledAt: "2026-06-20T00:00:00.000Z" }),
        pool: "today",
        ...handlers,
      }),
    );
    expect(host.querySelector('[aria-label="编辑重复与时间"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("宽屏点日期 chip 调 onEditSchedule 并传锚点", async () => {
    const onEditSchedule = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ scheduledAt: "2026-06-20T00:00:00.000Z" }),
        pool: "today",
        wide: true,
        onEditSchedule,
        ...handlers,
      }),
    );
    const chip = host.querySelector('[aria-label="编辑重复与时间"]') as HTMLElement;

    await act(async () => chip.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onEditSchedule).toHaveBeenCalledTimes(1);
    expect(onEditSchedule.mock.calls[0]?.[1]).toBe(chip);
    await act(async () => root.unmount());
  });

  it("宽屏日期 chip 的 Enter 不冒泡打开详情", async () => {
    const onEdit = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ scheduledAt: "2026-06-20T00:00:00.000Z" }),
        pool: "today",
        wide: true,
        ...handlers,
        onEdit,
      }),
    );
    const chip = host.querySelector('[aria-label="编辑重复与时间"]') as HTMLElement;

    await act(async () => chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(onEdit).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("宽屏无日期非重复任务给计划入口", async () => {
    const onEditSchedule = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task(),
        pool: "inbox",
        wide: true,
        onEditSchedule,
        ...handlers,
      }),
    );
    const chip = host.querySelector('[aria-label="计划到某天"]') as HTMLElement;

    await act(async () => chip.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onEditSchedule).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("收件箱里残留过去 scheduledAt 的任务，宽屏给『计划到某天』而非过去日期 chip", async () => {
    const onEditSchedule = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ scheduledAt: "2026-06-10T00:00:00.000Z" }),
        pool: "inbox",
        wide: true,
        onEditSchedule,
        ...handlers,
      }),
    );
    expect(host.querySelector('[aria-label="编辑重复与时间"]')).toBeNull();
    expect(host.querySelector('[aria-label="计划到某天"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("可隐藏池移动、删除与计划入口，用于已完成尾巴", async () => {
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ done: true, scheduledAt: "2026-06-20T00:00:00.000Z" }),
        pool: "today",
        wide: true,
        showActions: false,
        ...handlers,
      }),
    );

    expect(host.querySelector('input[aria-label="完成 示例任务"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="回收件箱"]')).toBeNull();
    expect(host.querySelector('[aria-label="删除"]')).toBeNull();
    expect(host.querySelector('[aria-label="编辑重复与时间"]')).toBeNull();
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
    expect(host.querySelector('[data-testid="turn-badge"]')).toBeNull(); // null turn 不渲染徽章
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

  it("turn=null 宽屏显示纳入按钮，点击调 onTurnChange(task, me)", async () => {
    const onTurnChange = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ turn: null }),
        pool: "today",
        wide: true,
        ...handlers,
        onTurnChange,
      }),
    );
    const btn = host.querySelector('[aria-label="纳入回合"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => btn.click());
    expect(onTurnChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "me");
    await act(async () => root.unmount());
  });

  it("turn=me 宽屏显示回合按钮，点开弹段控并切到 running", async () => {
    const onTurnChange = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ turn: "me", turnAt: "2026-06-17T08:00:00.000Z" }),
        pool: "today",
        wide: true,
        ...handlers,
        onTurnChange,
      }),
    );
    const trigger = host.querySelector('[aria-label="切换回合"]') as HTMLButtonElement;
    await act(async () => trigger.click());
    // AnchoredPopover 把段控 portal 到 document.body，故从 body 查询；SegmentedControl 选项以文本内容作可访问名（无 aria-label 属性）。
    const running = Array.from(document.body.querySelectorAll('[role="radio"]')).find((b) =>
      (b.textContent ?? "").includes("在跑"),
    ) as HTMLButtonElement;
    expect(running).toBeTruthy();
    await act(async () => running.click());
    expect(onTurnChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "running");
    await act(async () => root.unmount());
  });

  it("回合段控退出流程回 null", async () => {
    const onTurnChange = vi.fn();
    const { host, root } = await render(
      createElement(TaskRow, {
        task: task({ turn: "parked", turnAt: "2026-06-17T08:00:00.000Z" }),
        pool: "today",
        wide: true,
        ...handlers,
        onTurnChange,
      }),
    );
    await act(async () => (host.querySelector('[aria-label="切换回合"]') as HTMLButtonElement).click());
    await act(async () => (document.body.querySelector('[aria-label="退出流程"]') as HTMLButtonElement).click());
    expect(onTurnChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), null);
    await act(async () => root.unmount());
  });
});
