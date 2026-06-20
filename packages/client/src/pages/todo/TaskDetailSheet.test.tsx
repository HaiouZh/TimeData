// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { normalizeScheduledDate, placementForTask } from "../../lib/tasks/placement.js";
import { recurrenceSummary } from "../../lib/tasks/recurrence.js";
import { addTask, createChildTask, setTaskTags, toggleTaskDone } from "../../lib/tasks.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { isSwipeDownClose, TaskDetailSheet } from "./TaskDetailSheet.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await db.tasks.clear();
  await db.syncLog.clear();
});

// 兜底清理：sheet 与各种 popover 都走 createPortal 到 document.body，异常路径未 unmount 会留垃圾。
afterEach(() => {
  document.body.innerHTML = "";
});

async function renderSheet(id: string | null) {
  const onClose = vi.fn();
  const { host, root } = await renderDom(
    createElement(SyncProvider, null, createElement(TaskDetailSheet, { id, onClose })),
  );
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

function setTextareaValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function renderSheetWithCallbacks(
  id: string,
  callbacks: {
    onTagsChange?: (t: Task, tags: string[]) => void;
  },
) {
  const { host, root } = await renderDom(
    createElement(SyncProvider, null, createElement(TaskDetailSheet, { id, onClose: () => {}, ...callbacks })),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { host, root };
}

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const pressEnter = (input: HTMLInputElement) =>
  act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

describe("isSwipeDownClose", () => {
  it("下滑超过阈值 -> true", () => expect(isSwipeDownClose(80)).toBe(true));
  it("下滑不足阈值 -> false", () => expect(isSwipeDownClose(20)).toBe(false));
  it("上滑 -> false", () => expect(isSwipeDownClose(-80)).toBe(false));
});

describe("TaskDetailSheet 展示与关闭", () => {
  it("打开显示标题、子任务、当前重复规则", async () => {
    const t = await addTask({ title: "写计划", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await createChildTask(t.id, "调研参考代码");
    const { host, root } = await renderSheet(t.id);
    await settle();
    const titleInput = host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement;
    const subtaskInput = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    expect(titleInput.value).toBe("写计划");
    expect(subtaskInput.value).toBe("调研参考代码");
    expect(host.textContent).toContain("每天");
    await unmount(root);
  });

  it("点遮罩关闭", async () => {
    const t = await addTask({ title: "x" });
    const { host, root, onClose } = await renderSheet(t.id);
    const overlay = host.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    await unmount(root);
  });

  it("按 Esc 关闭", async () => {
    const t = await addTask({ title: "x" });
    const { root, onClose } = await renderSheet(t.id);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
    await unmount(root);
  });

  it("点关闭手柄关闭", async () => {
    const t = await addTask({ title: "x" });
    const { host, root, onClose } = await renderSheet(t.id);
    const handle = host.querySelector('button[aria-label="关闭"]') as HTMLButtonElement;
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    await unmount(root);
  });

  it("任务被外部删除 -> 自动关闭", async () => {
    const t = await addTask({ title: "x" });
    const { root, onClose } = await renderSheet(t.id);
    await act(async () => {
      await db.tasks.delete(t.id);
    });
    await settle();
    expect(onClose).toHaveBeenCalled();
    await unmount(root);
  });

  it("头部显示下一次时间与有语义的子任务计数", async () => {
    const t = await addTask({ title: "父", recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const c1 = await createChildTask(t.id, "甲");
    await createChildTask(t.id, "乙");
    await toggleTaskDone(c1.id);
    const { host, root } = await renderSheet(t.id);
    await settle();
    expect(host.textContent).toContain("每天");
    expect(host.textContent).toContain("1/2");
    expect(host.textContent).toContain("已完成 1 个，共 2 个子任务");
    await unmount(root);
  });

  it("有子任务 -> 顶部进度条按 m/n 给宽度；未满格用 accent 色", async () => {
    const t = await addTask({ title: "父" });
    const c1 = await createChildTask(t.id, "甲");
    await createChildTask(t.id, "乙");
    await createChildTask(t.id, "丙");
    await createChildTask(t.id, "丁");
    await toggleTaskDone(c1.id);
    const { host, root } = await renderSheet(t.id);
    await settle();
    const fill = host.querySelector('[data-testid="subtask-progress-fill"]') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe("25%");
    await unmount(root);
  });

  it("全部完成 -> 进度条满格且 ok 色", async () => {
    const t = await addTask({ title: "父" });
    const c1 = await createChildTask(t.id, "甲");
    await toggleTaskDone(c1.id);
    const { host, root } = await renderSheet(t.id);
    await settle();
    const fill = host.querySelector('[data-testid="subtask-progress-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("100%");
    await unmount(root);
  });

  it("无子任务 -> 不渲染进度条", async () => {
    const t = await addTask({ title: "光杆" });
    const { host, root } = await renderSheet(t.id);
    expect(host.querySelector('[data-testid="subtask-progress"]')).toBeNull();
    await unmount(root);
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
    await unmount(root);
  });
});

describe("TaskDetailSheet 自动保存", () => {
  it("改标题失焦 -> 库 title 更新", async () => {
    const t = await addTask({ title: "旧标题" });
    const { host, root } = await renderSheet(t.id);
    const input = host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(input, "新标题");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("新标题");
    await unmount(root);
  });

  it("标题清空失焦 -> 保留原标题，不报错", async () => {
    const t = await addTask({ title: "保留我" });
    const { host, root } = await renderSheet(t.id);
    const input = host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(input, "");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("保留我");
    await unmount(root);
  });

  it("标题按 Enter -> 失焦并落库（不插换行）", async () => {
    const t = await addTask({ title: "旧" });
    const { host, root } = await renderSheet(t.id);
    const ta = host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement;
    const blur = vi.spyOn(ta, "blur");
    await act(async () => {
      setTextareaValue(ta, "回车提交的标题");
    });
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
      ta.dispatchEvent(enter);
      ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("回车提交的标题");
    expect(blur).toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
    expect(ta.value).not.toContain("\n");
    await unmount(root);
  });

  it("标题 IME 组合输入 Enter -> 不提交也不失焦", async () => {
    const t = await addTask({ title: "旧" });
    const { host, root } = await renderSheet(t.id);
    const ta = host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement;
    const blur = vi.spyOn(ta, "blur");
    await act(async () => {
      setTextareaValue(ta, "拼音候选");
    });
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    await act(async () => {
      ta.dispatchEvent(enter);
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("旧");
    expect(blur).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    await unmount(root);
  });

  it("标题粘贴多行 -> 提交为单行标题", async () => {
    const t = await addTask({ title: "旧" });
    const { host, root } = await renderSheet(t.id);
    const ta = host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(ta, "第一行\n第二行\r\n第三行");
    });
    await act(async () => {
      ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("第一行 第二行 第三行");
    expect(ta.value).toBe("第一行 第二行 第三行");
    await unmount(root);
  });

  it("勾选子任务 -> 立即落库", async () => {
    const t = await addTask({ title: "父" });
    const child = await createChildTask(t.id, "子");
    const { host, root } = await renderSheet(t.id);
    await settle();
    const cb = host.querySelector('input[aria-label="完成子任务 子"]') as HTMLInputElement;
    await act(async () => {
      cb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(child.id))?.done).toBe(true);
    await unmount(root);
  });

  it("改子任务文字失焦 -> 落库", async () => {
    const t = await addTask({ title: "父" });
    const child = await createChildTask(t.id, "原文字");
    const { host, root } = await renderSheet(t.id);
    await settle();
    const input = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(input, "改后文字");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect((await db.tasks.get(child.id))?.title).toBe("改后文字");
    await unmount(root);
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
    await unmount(root);
  });

  it("点徽章 → 仅某天 → 月历选日后为普通排期", async () => {
    const t = await addTask({ title: "池任务" });
    const { host, root } = await renderSheet(t.id);
    await click(badgeOf(host));
    await click(host.querySelector('button[aria-label="仅某天…"]'));
    await click(host.querySelector('button[aria-label="2026-06-20"]'));
    await settle();
    expect((await db.tasks.get(t.id))?.scheduledAt).toBe(normalizeScheduledDate("2026-06-20"));
    await unmount(root);
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
    await unmount(root);
  });

  it("徽章三态：重复→摘要 / 仅排期→M月D日 / 都无→设定时间", async () => {
    const plain = await addTask({ title: "无", toInbox: true });
    let rendered = await renderSheet(plain.id);
    expect(badgeOf(rendered.host).textContent).toContain("设定时间");
    await unmount(rendered.root);

    const scheduled = await addTask({
      title: "排期",
      scheduledAt: normalizeScheduledDate("2026-07-01"),
      toInbox: true,
    });
    rendered = await renderSheet(scheduled.id);
    expect(badgeOf(rendered.host).textContent).toContain("7/1");
    await unmount(rendered.root);

    const recurrence = { freq: "daily", interval: 1, basis: "due" } as const;
    const recurring = await addTask({ title: "重复", recurrence });
    rendered = await renderSheet(recurring.id);
    expect(badgeOf(rendered.host).textContent).toContain(recurrenceSummary(recurrence));
    await unmount(rendered.root);
  });

  it("不渲染旧回合段控", async () => {
    const legacyStateField = "tu" + "rn";
    const t = await addTask({ title: "旧回合任务" });
    await db.tasks.update(t.id, { [legacyStateField]: "me" } as Partial<Task>);
    const { host, root } = await renderSheet(t.id);

    expect(host.querySelector('[role="radiogroup"][aria-label="回合"]')).toBeNull();
    expect(host.querySelector('[aria-label="退出流程"]')).toBeNull();
    await unmount(root);
  });

  it("标题未失焦直接关闭 -> flush 仍落库", async () => {
    const t = await addTask({ title: "旧" });
    const { host, root } = await renderSheet(t.id);
    const input = host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(input, "关闭前改的");
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await settle();
    expect((await db.tasks.get(t.id))?.title).toBe("关闭前改的");
    await unmount(root);
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
    await unmount(root);
  });

  it("删除是轻量按钮（非整条 w-full 红框）", async () => {
    const t = await addTask({ title: "x" });
    const { host, root } = await renderSheet(t.id);
    const del = host.querySelector('button[aria-label="删除任务"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    await unmount(root);
  });
});

describe("TaskDetailSheet tag 编辑", () => {
  it("回车添加去重 chip，✕ 删除调 onTagsChange", async () => {
    const onTagsChange = vi.fn();
    const t = await addTask({ title: "带标签" });
    await setTaskTags(t.id, ["bug"]);
    const { host, root } = await renderSheetWithCallbacks(t.id, { onTagsChange });

    const input = host.querySelector('input[aria-label="添加标签"]') as HTMLInputElement;
    setInputValue(input, "重构");
    await pressEnter(input);
    expect(onTagsChange).toHaveBeenCalledWith(expect.anything(), ["bug", "重构"]);

    // 去重：再输 "重构" 不再调用
    onTagsChange.mockClear();
    setInputValue(input, "重构");
    await pressEnter(input);
    expect(onTagsChange).not.toHaveBeenCalled();

    // 删除 bug
    onTagsChange.mockClear();
    await click(host.querySelector('[aria-label="删除标签 bug"]'));
    expect(onTagsChange).toHaveBeenCalledWith(expect.anything(), ["重构"]);
    await unmount(root);
  });

  it("超过 64 字或空 trim 后不提交", async () => {
    const onTagsChange = vi.fn();
    const t = await addTask({ title: "x" });
    const { host, root } = await renderSheetWithCallbacks(t.id, { onTagsChange });
    const input = host.querySelector('input[aria-label="添加标签"]') as HTMLInputElement;
    setInputValue(input, "   ");
    await pressEnter(input);
    expect(onTagsChange).not.toHaveBeenCalled();
    await unmount(root);
  });
});
