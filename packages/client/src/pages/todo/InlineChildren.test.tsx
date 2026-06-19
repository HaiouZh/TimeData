// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { addTask, createChildTask, toggleTaskDone } from "../../lib/tasks.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { InlineChildren } from "./InlineChildren.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
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

async function renderChildren(parentId: string, mode: "draggable" | "static" | "readonly") {
  const onAfterWrite = vi.fn();
  const { host, root } = await renderDom(
    createElement(SyncProvider, null, createElement(InlineChildren, { parentId, mode, onAfterWrite })),
  );
  await settle();
  return { host, root, onAfterWrite };
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

describe("InlineChildren mode 行为矩阵", () => {
  it("draggable：有复选框、标题编辑、拖柄、新增按钮", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    expect(host.querySelectorAll('input[aria-label^="完成子任务"]').length).toBe(2);
    expect(host.querySelectorAll('textarea[aria-label="子任务标题"]').length).toBe(2);
    expect(host.querySelectorAll('button[aria-label^="拖动子任务"]').length).toBe(2);
    expect(host.querySelector('button[aria-label="添加子任务"]')).not.toBeNull();

    await unmount(root);
  });

  it("static：有复选框、标题编辑、新增按钮，无拖柄", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "static");

    expect(host.querySelectorAll('input[aria-label^="完成子任务"]').length).toBe(2);
    expect(host.querySelectorAll('textarea[aria-label="子任务标题"]').length).toBe(2);
    expect(host.querySelector('button[aria-label="添加子任务"]')).not.toBeNull();
    expect(host.querySelectorAll('button[aria-label^="拖动子任务"]').length).toBe(0);

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

  it("draggable 勾选子任务 → 落库并触发 onAfterWrite", async () => {
    const parent = await seedParentWithChildren();
    const { host, root, onAfterWrite } = await renderChildren(parent.id, "draggable");

    const cb = host.querySelector('input[aria-label^="完成子任务"]') as HTMLInputElement;
    await act(async () => {
      cb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    expect(children[0].done).toBe(true);
    expect(onAfterWrite).toHaveBeenCalled();

    await unmount(root);
  });

  it("draggable 点新增按钮 → 创建 child 并落库", async () => {
    const parent = await seedParentWithChildren();
    const { host, root, onAfterWrite } = await renderChildren(parent.id, "draggable");

    const addBtn = host.querySelector('button[aria-label="添加子任务"]') as HTMLButtonElement;
    await act(async () => {
      addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).toArray();
    expect(children.length).toBe(3);
    expect(onAfterWrite).toHaveBeenCalled();

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

    const input = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, "改后标题");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();

    const children = await db.tasks.where("parentId").equals(parent.id).sortBy("sortOrder");
    expect(children[0].title).toBe("改后标题");

    await unmount(root);
  });

  it("子任务行不渲染 recurrence / tags / turn / scheduledAt 入口", async () => {
    const parent = await seedParentWithChildren();
    const { host, root } = await renderChildren(parent.id, "draggable");

    expect(host.querySelector('[aria-label="编辑重复与时间"]')).toBeNull();
    expect(host.querySelector('[data-testid="turn-badge"]')).toBeNull();
    expect(host.querySelector('[data-testid="tag-chip"]')).toBeNull();

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