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

  // 上一条用例的两个 toContain 都读 host.textContent，而添加失败时候选列表**仍开着**——
  // 「贴砖」是被那个候选按钮满足的，错误文案本身从没被断言过。终审三条镜头独立抓到：
  // cycleBlameTitle 当时被喂了入边（listRelationsBlocking），BFS 一步走不出去、恒返回「（已删除）」，
  // 而用例照样绿。下面两条改读 task-waiting-error 那个节点，把点名钉死。
  it("成环提示点名造成环的那一条（直接互挡）", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(a.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    await click(host.querySelector('button[aria-label="添加前置 贴砖"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const message = host.querySelector('[data-testid="task-waiting-error"]')?.textContent ?? "";
    expect(message).toContain("绕成圈");
    expect(message).toContain("贴砖"); // a 挡着贴砖，所以贴砖正是「已经在等这条」的那一方
    expect(message).not.toContain("已删除");
    await unmount(root);
  });

  it("成环提示点名的是路径首跳，不是候选本身", async () => {
    // a 挡 b、b 挡 c。在 a 的详情里把 c 加成 a 的前置 → a 等 c、c 等 b、b 等 a，成环。
    // 直接等着 a 的是 b（首跳），不是候选 c——写候选就会说假话。
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    const c = await addTask({ title: "装踢脚线" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    await addTaskRelation({ blocker: { kind: "task", id: b.id }, blocked: { kind: "task", id: c.id } });
    const { host, root } = await renderRow(a.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    await click(host.querySelector('button[aria-label="添加前置 装踢脚线"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const message = host.querySelector('[data-testid="task-waiting-error"]')?.textContent ?? "";
    expect(message).toContain("贴砖");
    expect(message).not.toContain("装踢脚线");
    expect(await db.taskRelations.count()).toBe(2);
    await unmount(root);
  });

  it("已完成的前置标出「已完成」，不再读作还在挡着", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    await toggleTaskDone(a.id);
    const { host, root } = await renderRow(b.id);
    const blocker = host.querySelector('[data-testid="task-waiting-blocker"]');
    expect(blocker?.textContent).toContain("批腻子");
    expect(blocker?.textContent).toContain("已完成");
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
