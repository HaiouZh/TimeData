// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { addTask, updateSubtasks } from "../../lib/tasks.js";
import { normalizeScheduledDate, placementForTask } from "../../lib/tasks/placement.js";
import { recurrenceSummary } from "../../lib/tasks/recurrence.js";
import { TaskDetailSheet, isSwipeDownClose } from "./TaskDetailSheet.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await db.tasks.clear();
  await db.syncLog.clear();
});

async function renderSheet(id: string | null) {
  const onClose = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(SyncProvider, null, createElement(TaskDetailSheet, { id, onClose })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { host, root, onClose };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const click = (el: Element | null) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

const badgeOf = (host: HTMLElement) => host.querySelector('button[aria-label="编辑重复与时间"]') as HTMLButtonElement;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setTextareaValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("isSwipeDownClose", () => {
  it("下滑超过阈值 -> true", () => expect(isSwipeDownClose(80)).toBe(true));
  it("下滑不足阈值 -> false", () => expect(isSwipeDownClose(20)).toBe(false));
  it("上滑 -> false", () => expect(isSwipeDownClose(-80)).toBe(false));
});

describe("TaskDetailSheet 展示与关闭", () => {
  it("打开显示标题、子任务、当前重复规则", async () => {
    const t = await addTask({ title: "写计划", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await updateSubtasks(t.id, [{ id: "s1", title: "调研参考代码", done: false }]);
    const { host, root } = await renderSheet(t.id);
    const titleInput = host.querySelector('input[aria-label="任务标题"]') as HTMLInputElement;
    const subtaskInput = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    expect(titleInput.value).toBe("写计划");
    expect(subtaskInput.value).toBe("调研参考代码");
    expect(host.textContent).toContain("每天");
    await act(async () => root.unmount());
  });

  it("点遮罩关闭", async () => {
    const t = await addTask({ title: "x" });
    const { host, root, onClose } = await renderSheet(t.id);
    const overlay = host.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("按 Esc 关闭", async () => {
    const t = await addTask({ title: "x" });
    const { root, onClose } = await renderSheet(t.id);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("点关闭手柄关闭", async () => {
    const t = await addTask({ title: "x" });
    const { host, root, onClose } = await renderSheet(t.id);
    const handle = host.querySelector('button[aria-label="关闭"]') as HTMLButtonElement;
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("任务被外部删除 -> 自动关闭", async () => {
    const t = await addTask({ title: "x" });
    const { root, onClose } = await renderSheet(t.id);
    await act(async () => {
      await db.tasks.delete(t.id);
    });
    await settle();
    expect(onClose).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("头部显示下一次时间与子任务计数", async () => {
    const t = await addTask({ title: "父", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await updateSubtasks(t.id, [
      { id: "s1", title: "甲", done: true },
      { id: "s2", title: "乙", done: false },
    ]);
    const { host, root } = await renderSheet(t.id);
    expect(host.textContent).toContain("每天");
    expect(host.textContent).toContain("1/2 子任务");
    await act(async () => root.unmount());
  });

  it("点放大按钮切换全屏高度", async () => {
    const t = await addTask({ title: "x" });
    const { host, root } = await renderSheet(t.id);
    const sheet = host.querySelector('[data-testid="detail-sheet"]') as HTMLElement;
    expect(sheet.className).not.toContain("h-[90vh]");
    const expand = host.querySelector('button[aria-label="放大"]') as HTMLButtonElement;
    await act(async () => {
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(sheet.className).toContain("h-[90vh]");
    await act(async () => root.unmount());
  });
});

describe("TaskDetailSheet 自动保存", () => {
  it("改标题失焦 -> 库 title 更新", async () => {
    const t = await addTask({ title: "旧标题" });
    const { host, root } = await renderSheet(t.id);
    const input = host.querySelector('input[aria-label="任务标题"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "新标题");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("新标题");
    await act(async () => root.unmount());
  });

  it("标题清空失焦 -> 保留原标题，不报错", async () => {
    const t = await addTask({ title: "保留我" });
    const { host, root } = await renderSheet(t.id);
    const input = host.querySelector('input[aria-label="任务标题"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("保留我");
    await act(async () => root.unmount());
  });

  it("勾选子任务 -> 立即落库", async () => {
    const t = await addTask({ title: "父" });
    await updateSubtasks(t.id, [{ id: "s1", title: "子", done: false }]);
    const { host, root } = await renderSheet(t.id);
    const cb = host.querySelector('input[aria-label="完成子任务 子"]') as HTMLInputElement;
    await act(async () => {
      cb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.subtasks[0].done).toBe(true);
    await act(async () => root.unmount());
  });

  it("改子任务文字失焦 -> 落库", async () => {
    const t = await addTask({ title: "父" });
    await updateSubtasks(t.id, [{ id: "s1", title: "原文字", done: false }]);
    const { host, root } = await renderSheet(t.id);
    const input = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(input, "改后文字");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.subtasks[0].title).toBe("改后文字");
    await act(async () => root.unmount());
  });

  it("点徽章开预设门，选『每天』→ 池任务变重复任务", async () => {
    const t = await addTask({ title: "池任务" });
    const { host, root } = await renderSheet(t.id);
    await click(badgeOf(host));
    await click(host.querySelector('button[aria-label="每天"]'));
    await settle();
    const saved = await db.tasks.get(t.id);
    expect(saved?.recurrence).not.toBeNull();
    expect(placementForTask(saved!, new Date()).pool).toBe("today");
    await act(async () => root.unmount());
  });

  it("点徽章 → 仅某天 → 月历选日后为普通排期", async () => {
    const t = await addTask({ title: "池任务" });
    const { host, root } = await renderSheet(t.id);
    await click(badgeOf(host));
    await click(host.querySelector('button[aria-label="仅某天…"]'));
    await click(host.querySelector('button[aria-label="2026-06-20"]'));
    await settle();
    expect((await db.tasks.get(t.id))?.scheduledAt).toBe(normalizeScheduledDate("2026-06-20"));
    await act(async () => root.unmount());
  });

  it("preset 打开时按 Esc 只关 preset，抽屉仍在", async () => {
    const t = await addTask({ title: "池任务" });
    const { host, root, onClose } = await renderSheet(t.id);
    await click(badgeOf(host));
    expect(host.querySelector('[aria-label="重复与时间"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await settle();

    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="重复与时间"]')).toBeNull();
    expect(host.querySelector('[data-testid="detail-sheet"]')).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("徽章三态：重复→摘要 / 仅排期→M月D日 / 都无→设定时间", async () => {
    const plain = await addTask({ title: "无", toInbox: true });
    let rendered = await renderSheet(plain.id);
    expect(badgeOf(rendered.host).textContent).toContain("设定时间");
    await act(async () => rendered.root.unmount());

    const scheduled = await addTask({
      title: "排期",
      scheduledAt: normalizeScheduledDate("2026-07-01"),
      toInbox: true,
    });
    rendered = await renderSheet(scheduled.id);
    expect(badgeOf(rendered.host).textContent).toContain("7月1日");
    await act(async () => rendered.root.unmount());

    const recurrence = { freq: "daily", interval: 1, basis: "due" } as const;
    const recurring = await addTask({ title: "重复", recurrence });
    rendered = await renderSheet(recurring.id);
    expect(badgeOf(rendered.host).textContent).toContain(recurrenceSummary(recurrence));
    await act(async () => rendered.root.unmount());
  });

  it("标题未失焦直接关闭 -> flush 仍落库", async () => {
    const t = await addTask({ title: "旧" });
    const { host, root } = await renderSheet(t.id);
    const input = host.querySelector('input[aria-label="任务标题"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "关闭前改的");
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("关闭前改的");
    await act(async () => root.unmount());
  });
});

describe("TaskDetailSheet 删除", () => {
  it("点删除 -> 任务从库消失并触发 onClose", async () => {
    const t = await addTask({ title: "待删" });
    const { host, root, onClose } = await renderSheet(t.id);
    const del = host.querySelector('button[aria-label="删除任务"]') as HTMLButtonElement;
    await act(async () => {
      del.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(await db.tasks.get(t.id)).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("删除是轻量按钮（非整条 w-full 红框）", async () => {
    const t = await addTask({ title: "x" });
    const { host, root } = await renderSheet(t.id);
    const del = host.querySelector('button[aria-label="删除任务"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    expect(del.className).not.toContain("w-full");
    await act(async () => root.unmount());
  });
});
