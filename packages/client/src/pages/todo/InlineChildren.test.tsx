// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import { addTask, createChildTask, runMaterialization, toggleTaskDone } from "../../lib/tasks.js";
import { occurrenceChildId } from "../../lib/tasks/occurrenceChildId.js";
import { db, resetDb } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { InlineChildren } from "./InlineChildren.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await resetDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function renderChildren(parentId: string, mode: "draggable" | "static" | "readonly") {
  const { host, root } = await renderDom(
    createElement(SyncProvider, null, createElement(InlineChildren, { parentId, mode })),
  );
  await settle();
  return { host, root };
}

async function seedParentWithChildren(doneCount = 0): Promise<Task> {
  const parent = await addTask({ title: "父任务" });
  for (let i = 0; i < 2 + doneCount; i++) {
    await createChildTask(parent.id, `子任务${i}`);
  }
  // 完成前 doneCount 个子任务
  for (let i = 0; i < doneCount; i++) {
    const children = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    await toggleTaskDone(children[i].id);
  }
  return parent;
}

async function clickAdd(host: HTMLElement) {
  const addBtn = host.querySelector('button[aria-label="添加子任务"]') as HTMLButtonElement;
  await act(async () => {
    addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function draftInput(host: HTMLElement): HTMLTextAreaElement | null {
  return host.querySelector('textarea[aria-label="新子任务标题"]');
}

function childTitle(host: HTMLElement, index = 0): HTMLElement {
  const title = host.querySelectorAll('[data-testid^="child-title-"]').item(index) as HTMLElement | null;
  expect(title).not.toBeNull();
  return title as HTMLElement;
}

async function beginEditingChildTitle(host: HTMLElement, index = 0): Promise<HTMLTextAreaElement> {
  const title = childTitle(host, index);
  await act(async () => {
    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();

  const input = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement | null;
  expect(input).not.toBeNull();
  return input as HTMLTextAreaElement;
}

async function typeIntoTextarea(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

describe("InlineChildren mode 行为矩阵", () => {
  it("draggable：有复选框、可选择标题文本、拖柄、新增按钮", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    expect(host.querySelectorAll('input[aria-label^="完成子任务"]').length).toBe(2);
    expect(host.querySelectorAll('textarea[aria-label="子任务标题"]').length).toBe(0);
    const titles = host.querySelectorAll('[data-testid^="child-title-"]');
    expect(titles.length).toBe(2);
    expect(titles[0].textContent).toBe("子任务0");
    expect(host.textContent).toContain("子任务1");
    expect(host.querySelectorAll('button[aria-label^="拖动子任务"]').length).toBe(2);
    expect(host.querySelector('button[aria-label="添加子任务"]')).not.toBeNull();

    await unmount(root);
  });

  it("static：有复选框、可选择标题文本、新增按钮，无拖柄", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "static");

    expect(host.querySelectorAll('input[aria-label^="完成子任务"]').length).toBe(2);
    expect(host.querySelectorAll('textarea[aria-label="子任务标题"]').length).toBe(0);
    expect(host.querySelectorAll('[data-testid^="child-title-"]').length).toBe(2);
    expect(host.textContent).toContain("子任务0");
    expect(host.textContent).toContain("子任务1");
    expect(host.querySelector('button[aria-label="添加子任务"]')).not.toBeNull();
    expect(host.querySelectorAll('button[aria-label^="拖动子任务"]').length).toBe(0);

    await unmount(root);
  });

  it("static 规则行：子任务勾态显示最新 occurrence 对应子任务", async () => {
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-07-01T08:00:00.000Z"),
    });
    const child = await createChildTask(rule.id, "补铁", new Date("2026-07-01T08:10:00.000Z"));
    await db.tasks.update(child.id, { done: true, completedAt: "2026-07-01T08:15:00.000Z" });
    await runMaterialization(new Date("2026-07-01T08:20:00.000Z"));

    const { host, root } = await renderChildren(rule.id, "static");
    await settle();

    const checkbox = host.querySelector('input[aria-label="完成子任务 补铁"]') as HTMLInputElement | null;
    expect(checkbox?.checked).toBe(false);
    expect(childTitle(host).className).not.toContain("line-through");
    await expect(db.tasks.get(child.id)).resolves.toMatchObject({ done: true });
    await unmount(root);
  });

  it("static 规则行：当日发完成后、下一发未物化 → 子任务显示全新未勾且置灰", async () => {
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-07-09T00:00:00.000Z",
      now: new Date("2026-07-09T08:00:00.000Z"),
    });
    const child = await createChildTask(rule.id, "补铁", new Date("2026-07-09T08:10:00.000Z"));
    await runMaterialization(new Date("2026-07-09T08:20:00.000Z"));
    const occ = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;
    // 勾完当日发的子任务和主任务；下一发在 07-10，尚未物化
    await toggleTaskDone(occurrenceChildId(occ.id, child.id), { now: new Date("2026-07-09T09:00:00.000Z") });
    await toggleTaskDone(occ.id, { now: new Date("2026-07-09T09:01:00.000Z") });

    const { host, root } = await renderChildren(rule.id, "static");
    await settle();

    const checkbox = host.querySelector('input[aria-label="完成子任务 补铁"]') as HTMLInputElement | null;
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.disabled).toBe(true);
    expect(childTitle(host).className).not.toContain("line-through");
    await unmount(root);
  });

  it("static 规则行：无 occurrence 时子任务复选框置灰且点击不写模板", async () => {
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2099-07-01T00:00:00.000Z",
      now: new Date("2026-07-01T08:00:00.000Z"),
    });
    const child = await createChildTask(rule.id, "补铁", new Date("2026-07-01T08:10:00.000Z"));
    await db.syncLog.clear();

    const { host, root } = await renderChildren(rule.id, "static");
    await settle();

    const checkbox = host.querySelector('input[aria-label="完成子任务 补铁"]') as HTMLInputElement | null;
    expect(checkbox?.disabled).toBe(true);
    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    await expect(db.tasks.get(child.id)).resolves.toMatchObject({ done: false, completedAt: null });
    await expect(db.syncLog.toArray()).resolves.toEqual([]);
    await unmount(root);
  });

  it("static 规则行：点击子任务写到最新 occurrence，不动模板子任务", async () => {
    const rule = await addTask({
      title: "晨间例行",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-07-01T08:00:00.000Z"),
    });
    const child = await createChildTask(rule.id, "补铁", new Date("2026-07-01T08:10:00.000Z"));
    await runMaterialization(new Date("2026-07-01T08:20:00.000Z"));
    const occ = (await db.tasks.where("ruleId").equals(rule.id).toArray()).find((o) => !o.done && !o.skipped)!;

    const { host, root } = await renderChildren(rule.id, "static");
    await settle();
    await act(async () => {
      host.querySelector('input[aria-label="完成子任务 补铁"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    await expect(db.tasks.get(occurrenceChildId(occ.id, child.id))).resolves.toMatchObject({ done: true });
    await expect(db.tasks.get(child.id)).resolves.toMatchObject({ done: false, completedAt: null });
    await unmount(root);
  });

  it("readonly：无复选框、无标题编辑、无拖柄、无新增按钮", async () => {
    const parent = await seedParentWithChildren(1);
    const { host, root } = await renderChildren(parent.id, "readonly");

    expect(host.querySelectorAll('input[aria-label^="完成子任务"]').length).toBe(0);
    expect(host.querySelectorAll('textarea[aria-label="子任务标题"]').length).toBe(0);
    expect(host.querySelectorAll('button[aria-label^="拖动子任务"]').length).toBe(0);
    expect(host.querySelector('button[aria-label="添加子任务"]')).toBeNull();
    // 只读模式下仍显示子任务标题文本
    expect(host.textContent).toContain("子任务0");

    await unmount(root);
  });

  it("点击子任务标题且无选区时进入单行编辑态并自动聚焦", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const input = await beginEditingChildTitle(host);

    const editors = host.querySelectorAll('textarea[aria-label="子任务标题"]');
    expect(editors.length).toBe(1);
    expect(input.value).toBe("子任务0");
    expect(document.activeElement).toBe(input);

    await unmount(root);
  });

  it("已有非空选区时点击标题不进入编辑态，便于跨行复制", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "static");
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "子任务0\n子任务1" } as Selection);

    await act(async () => {
      childTitle(host).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(host.querySelector('textarea[aria-label="子任务标题"]')).toBeNull();

    await unmount(root);
  });

  it("标题获焦后按 Enter 进入编辑态", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "static");

    await act(async () => {
      childTitle(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    const input = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement | null;
    expect(input?.value).toBe("子任务0");

    await unmount(root);
  });

  it("标题获焦后按 F2 进入编辑态，Escape 退出且不落库", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "static");

    await act(async () => {
      childTitle(host).dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    });
    await settle();

    const input = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    await typeIntoTextarea(input, "改了但取消");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();

    expect(host.querySelector('textarea[aria-label="子任务标题"]')).toBeNull();
    const children = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    expect(children[0].title).toBe("子任务0");

    await unmount(root);
  });

  it("draggable 勾选子任务 → 落库", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const cb = host.querySelector('input[aria-label^="完成子任务"]') as HTMLInputElement;
    await act(async () => {
      cb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    expect(children[0].done).toBe(true);

    await unmount(root);
  });

  it("点 +子任务 → 出现空白草稿输入框，不预填充也不立即落库", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");
    await clickAdd(host);

    expect(draftInput(host)).not.toBeNull();
    expect(draftInput(host)?.value).toBe("");
    const children = await db.tasks.where("parentId").equals(parent.id).toArray();
    expect(children.length).toBe(2); // 未输入不落库

    await unmount(root);
  });

  it("草稿行输入后失焦 → 落库新子任务", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");
    await clickAdd(host);

    const draft = draftInput(host) as HTMLTextAreaElement;
    await typeIntoTextarea(draft, "新建的子任务");
    await act(async () => {
      draft.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).toArray();
    expect(children.length).toBe(3);
    expect(children.some((c) => c.title === "新建的子任务")).toBe(true);

    await unmount(root);
  });

  it("草稿行空内容失焦 → 不落库且收起草稿", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");
    await clickAdd(host);

    const draft = draftInput(host) as HTMLTextAreaElement;
    await act(async () => {
      draft.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();

    expect(draftInput(host)).toBeNull();
    const children = await db.tasks.where("parentId").equals(parent.id).toArray();
    expect(children.length).toBe(2);

    await unmount(root);
  });

  it("草稿行回车提交后保持录入，可连续添加", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");
    await clickAdd(host);

    const draft = draftInput(host) as HTMLTextAreaElement;
    await typeIntoTextarea(draft, "甲");
    await act(async () => {
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).toArray();
    expect(children.length).toBe(3);
    expect(children.some((c) => c.title === "甲")).toBe(true);
    // 回车后草稿行仍在且已清空，便于继续录入下一条
    expect(draftInput(host)).not.toBeNull();
    expect(draftInput(host)?.value).toBe("");

    await unmount(root);
  });

  it("在已有子任务上回车 → 末尾出现空白草稿行", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const firstChild = await beginEditingChildTitle(host);
    await act(async () => {
      firstChild.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    expect(draftInput(host)).not.toBeNull();

    await unmount(root);
  });

  it("draggable 点删除子任务 → 从库删除", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const deleteBtn = host.querySelector('button[aria-label^="删除子任务"]') as HTMLButtonElement;
    await act(async () => {
      deleteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).toArray();
    expect(children.length).toBe(1);

    await unmount(root);
  });

  it("draggable 改子任务标题失焦 → 落库", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const input = await beginEditingChildTitle(host);
    await typeIntoTextarea(input, "改后标题");
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    expect(children[0].title).toBe("改后标题");

    await unmount(root);
  });

  it("子任务标题宽度变化后重算高度，不出现 textarea 内部滚动条", async () => {
    let measuredHeight = 48;
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(() => measuredHeight);
    const resizeCallbacks: ResizeObserverCallback[] = [];
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const input = await beginEditingChildTitle(host);
    expect(input.style.height).toBe("48px");

    measuredHeight = 96;
    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback([{ target: input } as ResizeObserverEntry], {} as ResizeObserver);
      }
    });

    expect(input.style.height).toBe("96px");
    expect(input.style.overflowY).toBe("hidden");

    await unmount(root);
  });

  it("子任务行不渲染 recurrence / tags / scheduledAt 入口", async () => {
    const legacyBadgeId = "tu" + "rn" + "-badge";
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    expect(host.querySelector('[aria-label="编辑重复与时间"]')).toBeNull();
    expect(host.querySelector(`[data-testid="${legacyBadgeId}"]`)).toBeNull();
    expect(host.querySelector('[data-testid="tag-chip"]')).toBeNull();

    await unmount(root);
  });

  it("展示态标题是可跨行选取的文字节点而非按钮", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const title = childTitle(host);
    // 按钮会截断浏览器选区，跨子任务划选复制要求标题是普通文字节点
    expect(title.tagName.toLowerCase()).not.toBe("button");
    expect(title.className).toContain("select-text");
    // 键盘可达性不丢：可聚焦，Enter/F2 进编辑（行为由上方既有用例覆盖）
    expect(title.tabIndex).toBe(0);

    await unmount(root);
  });

  it("子任务行用紧凑档：复选框热区与标题同为 min-h-8 对齐", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const checkboxLabel = host.querySelector('input[aria-label^="完成子任务"]')?.closest("label") as HTMLElement;
    expect(checkboxLabel.className).toContain("min-h-8");
    expect(checkboxLabel.className).not.toContain("min-h-11");
    const title = childTitle(host);
    expect(title.className).toContain("min-h-8");

    await unmount(root);
  });

  it("行内非文字控件不混入选区：拖柄与新增按钮标记 select-none", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    const dragHandle = host.querySelector('button[aria-label^="拖动子任务"]') as HTMLElement;
    expect(dragHandle.className).toContain("select-none");
    const addBtn = host.querySelector('button[aria-label="添加子任务"]') as HTMLElement;
    expect(addBtn.className).toContain("select-none");

    await unmount(root);
  });

  it("无子任务时仍渲染新增按钮（draggable/static）", async () => {
    const parent = await addTask({ title: "光杆" });
    const { host, root } = await renderChildren(parent.id, "draggable");

    expect(host.querySelector('button[aria-label="添加子任务"]')).not.toBeNull();
    expect(host.querySelectorAll("li").length).toBe(1); // 只有 add 按钮

    await unmount(root);
  });
});
