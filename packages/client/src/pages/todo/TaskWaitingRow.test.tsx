// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
// dbReset 必须排在一切会拉 db/index.js 的 import 之前（unit 桶不预装 fake-indexeddb，
// Dexie 在构造时即捕获 globalThis.indexedDB，顺序错了会 MissingAPIError）。
import { db, resetDb } from "../../test/dbReset.js";
import { addTask, toggleTaskDone } from "../../lib/tasks.js";
import { addTaskRelation } from "../../lib/taskRelations.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TaskWaitingRow } from "./TaskWaitingRow.js";

beforeEach(async () => {
  await resetDb();
});

async function renderRow(taskId: string) {
  const { host, root } = await renderDom(createElement(TaskWaitingRow, { taskId }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { host, root };
}

describe("TaskWaitingRow", () => {
  it("没有前置时显示空态与添加入口", async () => {
    const t = await addTask({ title: "贴砖" });
    const { host, root } = await renderRow(t.id);
    const row = host.querySelector('[data-testid="task-waiting-row"]');
    expect(row?.textContent).toContain("在等");
    expect(host.querySelector('button[aria-label="添加前置"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="task-waiting-blocker"]')).toBeNull();
    await unmount(root);
  });

  it("有前置时列出每个 blocker 的标题", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(b.id);
    const blockers = host.querySelectorAll('[data-testid="task-waiting-blocker"]');
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.textContent).toContain("批腻子");
    await unmount(root);
  });

  it("点添加后可选任务并写入关系", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    const { host, root } = await renderRow(b.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const candidate = host.querySelector('button[aria-label="添加前置 批腻子"]');
    expect(candidate).not.toBeNull();
    await click(candidate);
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockerKind: "task", blockerId: a.id, blockedKind: "task", blockedId: b.id });
    await unmount(root);
  });

  it("点移除后关系被删除", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(b.id);
    await click(host.querySelector('button[aria-label="移除前置 批腻子"]'));
    expect(await db.taskRelations.count()).toBe(0);
    await unmount(root);
  });

  it("选中会成环的目标时给出提示且不写入", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(a.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const candidate = host.querySelector('button[aria-label="添加前置 贴砖"]');
    expect(candidate).not.toBeNull();
    await click(candidate);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.textContent).toContain("绕成圈");
    expect(host.textContent).toContain("贴砖");
    expect(await db.taskRelations.count()).toBe(1);
    await unmount(root);
  });

  it("选择器不列出已完成的任务", async () => {
    const done = await addTask({ title: "已完成的前置" });
    await toggleTaskDone(done.id);
    const b = await addTask({ title: "贴砖" });
    const { host, root } = await renderRow(b.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    expect(host.querySelector('button[aria-label="添加前置 已完成的前置"]')).toBeNull();
    await unmount(root);
  });

  it("选择器不列出自己", async () => {
    const t = await addTask({ title: "我自己" });
    const { host, root } = await renderRow(t.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    expect(host.querySelector('button[aria-label="添加前置 我自己"]')).toBeNull();
    await unmount(root);
  });
});
